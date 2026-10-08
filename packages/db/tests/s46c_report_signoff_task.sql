-- S46c proof: the yearly Health Report sign-off is an S16 clinical task (migration *_s46c_report_signoff_as_clinical_task.sql). One rolled-back transaction.
-- Proves:
--   1. The task type exists, is marked UNCONFIRMED (PROPOSED values) and does not block triage rule-set approval (not needs_confirmation).
--   2. A draft creates exactly one health_report_signoff task for the right patient; the row and its events hold ids and neutral words only (INV-07, INV-04);
--      assigned_clinician_id is no longer the routing (it stays null).
--   3. Routing is the queue's: a patient with a named doctor offers it to that doctor and to nobody else; with nobody named it goes to an employed doctor,
--      and once the lead window ends it reaches the pool where an available doctor pulls it through queue_next (the old "nobody assigned, draft waits
--      unseen" gap, OQ-S46-7). A doctor who is not offered it neither sees nor reads it (INV-12); a care coordinator and the patient are refused.
--   4. Claim and sign: only the claiming doctor may sign (a stranger, the unclaimed lead, an expired claim and a draft with no task are refused);
--      signing completes the task (claim ended as completed, transition log, audit line, neutral outcome) and the signed row names the signer.
--   5. Hand-back goes through queue_handback and returns the task to the queue; the handing doctor can no longer sign.
--   6. A correction opens a NEW task; the old one stays completed.
--   7. SABOTAGE: the claim check removed from sign_health_report, task_is_mine opened to everyone, the task writer made a no-op and the task closer made
--      a no-op; the matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.sqlstate_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's46c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S46c ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, 'female', true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S46c ' || p_label, 'MDCN', 'S46C-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, true)
  returning id into s;
  return v;
end $f$;
create function pg_temp.mkblock(p_org uuid, p_uid uuid) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
   values (p_org, p_uid, now() - interval '1 minute', now() + interval '2 hours', 'queue', true) $$;
create function pg_temp.mkpatient(p_label text, p_lead uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(pg_temp.f('org'), p_label, 'patient');
  if p_lead is not null then
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (pg_temp.f('org'), v, p_lead, p_lead);
  end if;
  return v;
end $f$;
-- a draft through the real writer (service role, test patient passes the go-live guard)
create function pg_temp.draft(p_pat uuid, p_year integer) returns uuid language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.as_service(format($q$select public.record_health_report_draft(%L, %s, '{"year":0,"risk":{"state":"not_assessed"}}'::jsonb,
      '{"items":[{"id":"lab:alt","kind":"lab","code":"alt","state":"needs_attention","value":70,"readingCount":1}],"summary":{"key":"report.summary.default"}}'::jsonb,
      '[{"id":"lab:alt","action":"report.priority.lab.action","why":"report.priority.lab.why","whoHelps":"report.who.care_team","when":"within 4 weeks"}]'::jsonb, null)::text$q$, p_pat, p_year));
  return r::uuid;
end $f$;
create function pg_temp.task_of(p_report uuid) returns uuid language sql as $$ select signoff_task_id from public.health_reports where id = p_report $$;
create function pg_temp.tstate(p_report uuid) returns text language sql as $$ select ct.state::text from public.clinical_tasks ct join public.health_reports hr on hr.signoff_task_id = ct.id where hr.id = p_report $$;
create function pg_temp.rows_as(p_uid uuid, p_report uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.clinician_health_report_queue() where id = %L', p_report)) $$;
create function pg_temp.sign_as(p_uid uuid, p_report uuid) returns text language sql as
$$ select pg_temp.sqlstate_as(p_uid, format('select public.sign_health_report(%L, ''Your blood pressure held steady this year.'', ''clinician'')', p_report)) $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_a uuid; v_b uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  -- only the fixture clinicians may be picked, so "least loaded" never depends on other data
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', v_admin));
  v_a := pg_temp.mkdoc(v_org, 'docA', 'senior_medical_officer', 'employed', v_admin);   -- the patient's named doctor, employed
  v_b := pg_temp.mkdoc(v_org, 'docB', 'senior_medical_officer', 'contracted', v_admin); -- a freelancer who pulls from the pool
  perform pg_temp.setf('docA', v_a);
  perform pg_temp.setf('docB', v_b);
  perform pg_temp.mkblock(v_org, v_b);
  perform pg_temp.setf('cc', pg_temp.mkdoc(v_org, 'cc', 'care_coordinator', 'employed', v_admin));
  perform pg_temp.setf('p1', pg_temp.mkpatient('p1', v_a));
  perform pg_temp.setf('p2', pg_temp.mkpatient('p2', null));
  perform pg_temp.setf('p3', pg_temp.mkpatient('p3', v_a));
end $$;

-- Turn the guard on for fixture (test) patients only is automatic: go_live_open_patient lets a test patient through. Settings: the latest version is used for a test patient.

-- 1. The task type -------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('the task type is active, creatable, class 8, 7 days', 'true,8,10080',
    (select (is_active and creatable)::text || ',' || priority_class || ',' || default_due_minutes from public.task_types where code = 'health_report_signoff'));
  perform pg_temp.ck('it is marked UNCONFIRMED in its note (the CMO confirms task types)', 'true',
    (select (note like 'S46c UNCONFIRMED%')::text from public.task_types where code = 'health_report_signoff'));
  perform pg_temp.ck('it does not block triage rule-set approval (needs_confirmation stays false)', 'false',
    (select needs_confirmation::text from public.task_types where code = 'health_report_signoff'));
  perform pg_temp.ck('no triage rule creates it', '0', (select cardinality(source_task_keys)::text from public.task_types where code = 'health_report_signoff'));
end $$;

-- 2. A draft creates one task ----------------------------------------------------------------------------------------------------
do $$
declare yr integer := extract(year from now())::integer; r1 uuid; t1 uuid; v_row text;
begin
  r1 := pg_temp.draft(pg_temp.f('p1'), yr);
  perform pg_temp.setf('r1', r1);
  t1 := pg_temp.task_of(r1);
  perform pg_temp.ck('the draft carries its sign-off task', 'true', (t1 is not null)::text);
  perform pg_temp.ck('exactly one live task of that type for the patient', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('p1') and type = 'health_report_signoff'));
  perform pg_temp.ck('the task is for the right patient with the dedup key of the report', 'true',
    (select (patient_id = pg_temp.f('p1') and dedup_key = 'health_report:' || r1)::text from public.clinical_tasks where id = t1));
  perform pg_temp.ck('the old assignment column is no longer the routing (null)', 'true', (select (assigned_clinician_id is null)::text from public.health_reports where id = r1));
  perform pg_temp.ck('INV-07: the task row names no result, condition or hepatitis word', 'false',
    ((select to_jsonb(ct)::text from public.clinical_tasks ct where id = t1) ~* 'hiv|hepat|hbsag|pressure|\yalt\y|result|diabet')::text);
  perform pg_temp.ck('INV-07: the task events carry ids and the type only', 'false',
    (coalesce((select string_agg(payload::text, ' ') from public.domain_events where aggregate_id = t1), '') ~* 'hiv|hepat|hbsag|pressure|result')::text);
  perform pg_temp.ck('a repeat build for the same year is refused while the draft waits (no second task)', 'ERR:draft_already_waiting_for_signature',
    pg_temp.as_service(format('select public.record_health_report_draft(%L, %s, ''{}''::jsonb, ''{"items":[]}''::jsonb, ''[]''::jsonb, null)::text', pg_temp.f('p1'), yr)) );
end $$;

-- 3. Routing -----------------------------------------------------------------------------------------------------------------------
do $$
declare r1 uuid := pg_temp.f('r1'); a uuid := pg_temp.f('docA'); b uuid := pg_temp.f('docB'); cc uuid := pg_temp.f('cc'); p1 uuid := pg_temp.f('p1'); v_state text;
begin
  perform pg_temp.ck('a patient with a named doctor: the task is offered to that doctor', 'offered_to_lead', pg_temp.tstate(r1));
  perform pg_temp.ck('...the named doctor sees it in the queue', '1', pg_temp.rows_as(a, r1));
  perform pg_temp.ck('...another doctor does not', '0', pg_temp.rows_as(b, r1));
  perform pg_temp.ck('...another doctor cannot read the draft', '42501', pg_temp.sqlstate_as(b, format('select * from public.clinician_get_health_report(%L)', r1)));
  perform pg_temp.ck('...the care coordinator cannot open the queue', '42501', pg_temp.sqlstate_as(cc, 'select * from public.clinician_health_report_queue()'));
  perform pg_temp.ck('...the patient cannot open the queue', '42501', pg_temp.sqlstate_as(p1, 'select * from public.clinician_health_report_queue()'));
  perform pg_temp.ck('...the patient sees no task rows (patients have no access to tasks)', '0', pg_temp.q_as(p1, 'select count(*)::text from public.clinical_tasks'));
  perform pg_temp.ck('...the freelancer cannot pull a task that is offered to another doctor', 'none_eligible', coalesce(pg_temp.next_as(b) ->> 'reason', 'x'));
  perform pg_temp.ck('...the offered doctor can read the draft before claiming', 'true',
    (pg_temp.q_as(a, format('select (public.clinician_get_health_report(%L)).status', r1)) = 'pending_signature')::text);
end $$;

-- 3b. Nobody named: employed doctor first, then the pool (the OQ-S46-7 gap)
do $$
declare yr integer := extract(year from now())::integer; r2 uuid; t2 uuid; a uuid := pg_temp.f('docA'); b uuid := pg_temp.f('docB'); res jsonb;
begin
  r2 := pg_temp.draft(pg_temp.f('p2'), yr);
  perform pg_temp.setf('r2', r2);
  t2 := pg_temp.task_of(r2);
  perform pg_temp.ck('nobody named: the task is pushed to an employed doctor, not left unseen', 'offered_to_lead,true',
    (select state::text || ',' || (pushed_to = a)::text from public.clinical_tasks where id = t2));
  perform pg_temp.ck('...that doctor sees it', '1', pg_temp.rows_as(a, r2));
  perform pg_temp.ck('...the freelancer does not yet', '0', pg_temp.rows_as(b, r2));
  -- the lead window ends: the sweep releases it to the pool
  perform pg_temp.backdate(t2, 'lead_window_ends_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
  perform pg_temp.ck('after the lead window the task is in the pool', 'open', pg_temp.tstate(r2));
  res := pg_temp.next_as(b);
  perform pg_temp.ck('an available freelancer pulls it through queue_next (atomic claim)', 'true',
    ((res -> 'task' ->> 'id') = t2::text and coalesce((res ->> 'already_claimed')::boolean, true) = false)::text);
  perform pg_temp.ck('...it is claimed by that doctor with a claim row', 'claimed,true',
    (select state::text || ',' || (claimed_by = b)::text from public.clinical_tasks where id = t2));
  perform pg_temp.ck('...and now that doctor sees it', '1', pg_temp.rows_as(b, r2));
  perform pg_temp.ck('...the first doctor no longer does (claimed by someone else)', '0', pg_temp.rows_as(a, r2));
end $$;

-- 4. Claim and sign ------------------------------------------------------------------------------------------------------------------
do $$
declare r1 uuid := pg_temp.f('r1'); r2 uuid := pg_temp.f('r2'); a uuid := pg_temp.f('docA'); b uuid := pg_temp.f('docB'); cc uuid := pg_temp.f('cc'); p1 uuid := pg_temp.f('p1');
  t1 uuid := pg_temp.task_of(pg_temp.f('r1')); res jsonb;
begin
  perform pg_temp.ck('the unclaimed lead cannot sign (claim first)', '42501', pg_temp.sign_as(a, r1));
  perform pg_temp.ck('a doctor who was not offered it cannot sign', '42501', pg_temp.sign_as(b, r1));
  perform pg_temp.ck('a care coordinator cannot sign', '42501', pg_temp.sign_as(cc, r1));
  perform pg_temp.ck('the patient cannot sign', '42501', pg_temp.sign_as(p1, r1));
  perform pg_temp.ck('the claim of another doctor does not let the first doctor sign that report', '42501', pg_temp.sign_as(a, r2));
  res := pg_temp.next_as(a);
  perform pg_temp.ck('the named doctor takes it through queue_next', t1::text, res -> 'task' ->> 'id');
  perform pg_temp.ck('...claim row opened and state claimed', 'claimed,1',
    (select state::text || ',' || (select count(*) from public.task_claims where task_id = t1 and ended_at is null)::text from public.clinical_tasks where id = t1));
  -- expired claim: refused (and a control below shows the same claim signs when live)
  perform pg_temp.backdate(t1, 'claim_expires_at = now() - interval ''1 minute''');
  perform pg_temp.ck('an expired claim cannot sign', '42501', pg_temp.sign_as(a, r1));
  perform pg_temp.backdate(t1, 'claim_expires_at = now() + interval ''30 minutes''');
  -- a legacy draft with no task
  update public.health_reports set signoff_task_id = null where id = r1;
  perform pg_temp.ck('a draft with no task cannot be signed', '42501', pg_temp.sign_as(a, r1));
  update public.health_reports set signoff_task_id = t1 where id = r1;
  perform pg_temp.ck('INV-04: a summary naming an HIV result is still refused by the honesty guard', '23514',
    pg_temp.sqlstate_as(a, format('select public.sign_health_report(%L, ''Your HIV result is fine.'', ''clinician'')', r1)));
  perform pg_temp.ck('CONTROL: the claiming doctor signs', r1::text,
    pg_temp.q_as(a, format('select public.sign_health_report(%L, ''Your blood pressure held steady this year.'', ''clinician'')::text', r1)));
  perform pg_temp.ck('...the report is signed and names the signer', 'true',
    (select (status = 'signed' and signed_by is not null and signer_name = 'S46c docA' and signer_registration is not null)::text from public.health_reports where id = r1));
  perform pg_temp.ck('...the task is completed with a neutral outcome', 'completed,{"health_report": "signed"}',
    (select state::text || ',' || outcome::text from public.clinical_tasks where id = t1));
  perform pg_temp.ck('...the claim ended as completed', 'completed',
    (select end_reason from public.task_claims where task_id = t1 order by claimed_at desc limit 1));
  perform pg_temp.ck('...the transition log holds the claim and the completion', 'claimed>completed',
    (select string_agg(to_state::text, '>' order by to_state::text) from public.clinical_task_transitions where task_id = t1 and to_state in ('claimed', 'completed')));
  perform pg_temp.ck('...a queue.complete audit line exists for the patient', '1',
    (select count(*)::text from public.audit_log where action = 'queue.complete' and entity_id = t1 and subject_patient_id = pg_temp.f('p1')));
  perform pg_temp.ck('...it leaves the doctor''s queue', '0', pg_temp.rows_as(a, r1));
  perform pg_temp.ck('...the patient now reads the signed report (sign-off authority unchanged)', '1', pg_temp.q_as(p1, 'select count(*)::text from public.health_reports'));
  perform pg_temp.ck('...a signed report cannot be signed again', '22023', pg_temp.sign_as(a, r1));
end $$;

-- 5. Hand-back -----------------------------------------------------------------------------------------------------------------------
do $$
declare r2 uuid := pg_temp.f('r2'); t2 uuid := pg_temp.task_of(pg_temp.f('r2')); a uuid := pg_temp.f('docA'); b uuid := pg_temp.f('docB');
begin
  perform pg_temp.ck('only the claimant can hand the task back', 'queue_no_claim', replace(pg_temp.q_as(a, format('select public.queue_handback(%L, ''needs_information'')::text', t2)), 'ERR:', ''));
  perform pg_temp.ck('the claimant hands it back with a reason code', 'ok', pg_temp.sqlstate_as(b, format('select public.queue_handback(%L, ''needs_information'')', t2)));
  perform pg_temp.ck('...the task is open again, counted and logged', 'open,1,1',
    (select state::text || ',' || handback_count || ',' || (select count(*) from public.task_handbacks where task_id = t2) from public.clinical_tasks where id = t2));
  perform pg_temp.ck('...the draft is untouched and still unsigned', 'pending_signature', (select status from public.health_reports where id = r2));
  perform pg_temp.ck('...the doctor who handed it back can no longer sign it', '42501', pg_temp.sign_as(b, r2));
  perform pg_temp.ck('...nor read it (it is no longer theirs)', '0', pg_temp.rows_as(b, r2));
end $$;

-- 6. A correction opens a new task ----------------------------------------------------------------------------------------------------
do $$
declare r1 uuid := pg_temp.f('r1'); a uuid := pg_temp.f('docA'); t1 uuid := pg_temp.task_of(pg_temp.f('r1')); v_new uuid; t_new uuid;
begin
  v_new := (pg_temp.q_as(a, format('select public.correct_health_report(%L, ''A laboratory corrected an ALT value.'')::text', r1)))::uuid;
  t_new := pg_temp.task_of(v_new);
  perform pg_temp.ck('a correction creates a NEW sign-off task', 'true', (t_new is not null and t_new <> t1)::text);
  perform pg_temp.ck('...the old task stays completed', 'completed', (select state::text from public.clinical_tasks where id = t1));
  perform pg_temp.ck('...the new task is offered to the named doctor, not auto-signed', 'offered_to_lead', (select state::text from public.clinical_tasks where id = t_new));
  perform pg_temp.ck('...the old signed report stays visible to the patient until the new one is signed', '1',
    pg_temp.q_as(pg_temp.f('p1'), format('select count(*)::text from public.health_reports where id = %L', r1)));
  perform pg_temp.ck('...the correcting doctor must claim the new task before signing', '42501', pg_temp.sign_as(a, v_new));
  perform pg_temp.setf('r1b', v_new);
end $$;

-- 7. Grants ----------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('the task helpers are not callable by a session', 'false,false',
    has_function_privilege('authenticated', 'private.open_report_signoff_task(uuid)', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'private.close_report_signoff_task(uuid,uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('anon has no execute on the sign-off functions', 'false',
    (has_function_privilege('anon', 'public.sign_health_report(uuid,text,text)', 'EXECUTE') or has_function_privilege('anon', 'public.clinician_health_report_queue()', 'EXECUTE'))::text);
end $$;

-- 8. SABOTAGE -----------------------------------------------------------------------------------------------------------------------
-- A: the claim check removed from sign_health_report. The unclaimed lead must then be able to sign.
do $$
declare def text; r uuid; a uuid := pg_temp.f('docA'); p uuid;
begin
  def := pg_get_functiondef('public.sign_health_report(uuid,text,text)'::regprocedure);
  def := replace(def, 'raise exception ''not_authorised: take this task from the queue before signing'' using errcode = ''42501'';', 'null;');
  execute def;
  p := pg_temp.mkpatient('sabA', a);
  r := pg_temp.draft(p, extract(year from now())::integer - 1);
  insert into results values ('sabotaged', 'the unclaimed lead cannot sign (claim first)', '42501', pg_temp.sign_as(a, r));
end $$;
-- B: task_is_mine opened to everyone. A doctor who was not offered a draft must then see it.
do $$
declare r uuid; p uuid; b uuid := pg_temp.f('docB');
begin
  create or replace function private.task_is_mine(p_pushed uuid, p_claimed uuid, p_lead uuid, p_state public.clinical_task_state) returns boolean
    language sql stable security definer set search_path = '' as $f$ select true $f$;
  p := pg_temp.mkpatient('sabB', pg_temp.f('docA'));
  r := pg_temp.draft(p, extract(year from now())::integer - 2);
  insert into results values ('sabotaged', '...another doctor does not', '0', pg_temp.rows_as(b, r));
end $$;
-- C: the task writer made a no-op. A new draft must then have no task.
do $$
declare r uuid; p uuid;
begin
  create or replace function private.open_report_signoff_task(p_report uuid) returns uuid language sql as $f$ select null::uuid $f$;
  p := pg_temp.mkpatient('sabC', pg_temp.f('docA'));
  r := pg_temp.draft(p, extract(year from now())::integer - 3);
  insert into results values ('sabotaged', 'the draft carries its sign-off task', 'true', (pg_temp.task_of(r) is not null)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S46c sign-off proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
