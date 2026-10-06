-- S22b proof: membership, the queue_next type filter, and idempotent submit (migration *_s22b_membership_claim_filter_idempotent_submit.sql).
-- Proves in one rolled-back transaction: nobody is a member by default; only an admin or the CMO can grant or end one, with a
-- reason, audited; a dated membership lapses by itself; a member can send a written question; queue_next(types) claims only the
-- types asked for and the no-argument call keeps the old strict order; a retry with the same client id returns the first
-- question and uses one allowance. SABOTAGE: membership always true, and the retry check removed; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as anon
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
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
create function pg_temp.next_task(p_uid uuid) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid $$;
-- 'claimed', the error code, or the reason no task was given
create function pg_temp.next_outcome(p_uid uuid) returns text language sql as
$$ select coalesce(r ->> 'error', case when jsonb_typeof(r -> 'task') = 'object' then 'claimed' else r ->> 'reason' end)
     from (select pg_temp.next_as(p_uid) as r) x $$;
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
  values (v, 's22-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S22 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S22 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.mkblock(p_org uuid, p_uid uuid) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
   values (p_org, p_uid, now() - interval '1 minute', now() + interval '2 hours', 'queue', true) $$;
create function pg_temp.mktask(p_patient uuid, p_type text, p_due integer default null) returns uuid language sql as
$$ select private.create_clinical_task(p_patient, p_type, p_due) $$;
-- fixture cleanup without deleting (the logs are append only): end any live claim and cancel what is left
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
create function pg_temp.state_of(p_task uuid) returns text language sql as $$ select state::text from public.clinical_tasks where id = p_task $$;
create function pg_temp.score_of(p_uid uuid) returns text language sql as $$ select reliability_score::text from public.clinical_staff where profile_id = p_uid $$;




-- S22b helpers
create function pg_temp.staff_of(p_uid uuid) returns uuid language sql as $$ select id from public.clinical_staff where profile_id = p_uid $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.submit(p_uid uuid, p_q text, p_client uuid default null) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.submit_written_question(%L, %L, null, %L)::text', 'symptom', p_q, p_client)) $$;
create function pg_temp.queue_as(p_uid uuid, p_types text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute format('select public.queue_next(%s)', p_types) into r; exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'medical_officer', 'contracted', '{adult_general,hypertension}', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{adult_general,hypertension,on_call}', v_admin));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc'));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('pat3', pg_temp.mkuser(v_org, 'pat3', 'patient'));
  update public.profiles set full_name = 'S22b Proof Patient' where id = pg_temp.f('pat');
end $$;

-- 1. Membership ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_admin uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo'); v_doc uuid := pg_temp.f('doc');
  v_m uuid;
begin
  perform pg_temp.ck('nobody is a member to start with', 'false', (select private.patient_is_member(v_pat)::text));
  perform pg_temp.ck('a non-member cannot send a written question', 'true',
    (pg_temp.submit(v_pat, 'My knee has been swollen for two days') like 'ERR:Written messages to your care team are part of Membership%')::text);
  perform pg_temp.ck('a patient cannot grant themselves a membership', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.grant_membership(%L, null, 'Granting myself a membership')$q$, v_pat)) like 'membership_not_authorised%')::text);
  perform pg_temp.ck('an ordinary clinician cannot grant one', 'true',
    (pg_temp.try_as(v_doc, format($q$select public.grant_membership(%L, null, 'A doctor trying to grant one')$q$, v_pat)) like 'membership_not_authorised%')::text);
  perform pg_temp.ck('a grant needs a real reason', 'membership_reason_needed',
    pg_temp.try_as(v_admin, format($q$select public.grant_membership(%L, null, 'short')$q$, v_pat)));
  perform pg_temp.ck('an end date in the past is refused', 'membership_end_in_past',
    pg_temp.try_as(v_admin, format($q$select public.grant_membership(%L, now() - interval '1 day', 'Granting with a past end date')$q$, v_pat)));
  perform pg_temp.ck('an admin grants a membership', 'ok',
    pg_temp.try_as(v_admin, format($q$select public.grant_membership(%L, null, 'Founder approved pilot member for the clinic launch')$q$, v_pat)));
  perform pg_temp.ck('...the patient is now a member', 'true', (select private.patient_is_member(v_pat)::text));
  perform pg_temp.ck('...the grant is audited with the reason', '1',
    (select count(*)::text from public.audit_log where action = 'membership.grant' and subject_patient_id = v_pat and reason like 'Founder approved%'));
  perform pg_temp.ck('...a second grant while one is active is refused', 'membership_already_active',
    pg_temp.try_as(v_cmo, format($q$select public.grant_membership(%L, null, 'The CMO tries to grant twice here')$q$, v_pat)));
  perform pg_temp.ck('...and the member can send a written question', 'true',
    (pg_temp.submit(v_pat, 'My knee has been swollen for two days') ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.ck('the membership table has no direct path', 'true',
    (pg_temp.q_as(v_pat, 'select count(*)::text from public.patient_memberships') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('an admin can search and see who is a member', 'true',
    (pg_temp.q_as(v_admin, $q$select public.list_memberships('S22b Proof')::text$q$) like '%"is_member": true%')::text);
  perform pg_temp.ck('a clinician cannot list members', 'true',
    (pg_temp.q_as(v_doc, $q$select public.list_memberships(null)::text$q$) like 'ERR:membership_not_authorised%')::text);
  perform pg_temp.ck('ending needs a real reason', 'membership_reason_needed', pg_temp.try_as(v_admin, format($q$select public.end_membership(%L, 'no')$q$, v_pat)));
  perform pg_temp.ck('the CMO can end a membership', 'ok',
    pg_temp.try_as(v_cmo, format($q$select public.end_membership(%L, 'Pilot finished, ended by the CMO')$q$, v_pat)));
  perform pg_temp.ck('...and the patient is no longer a member', 'false', (select private.patient_is_member(v_pat)::text));
  -- a dated membership lapses by itself
  perform pg_temp.ck('a dated membership is granted', 'ok',
    pg_temp.try_as(v_admin, format($q$select public.grant_membership(%L, now() + interval '1 hour', 'Short pilot membership for a launch week')$q$, pg_temp.f('pat2'))));
  perform pg_temp.ck('...and counts while it runs', 'true', (select private.patient_is_member(pg_temp.f('pat2'))::text));
  update public.patient_memberships set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where patient_id = pg_temp.f('pat2');
  perform pg_temp.ck('...and stops counting after its end date, with nobody doing anything', 'false', (select private.patient_is_member(pg_temp.f('pat2'))::text));
end $$;

-- 2. queue_next asks for its own types ----------------------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_pat3 uuid := pg_temp.f('pat3'); v_bp uuid; v_wq uuid; r jsonb;
begin
  perform pg_temp.clear_queue();
  v_bp := private.create_clinical_task(v_pat3, 'amber_bp_review');
  v_wq := private.create_clinical_task(v_pat3, 'async_question');
  r := pg_temp.queue_as(v_doc, $a$array['written_question_call']$a$);
  perform pg_temp.ck('asking for a type nobody has waiting claims nothing', 'none_eligible', coalesce(r ->> 'reason', r ->> 'error'));
  perform pg_temp.ck('...and leaves the other tasks open', 'true', (pg_temp.state_of(v_bp) in ('open', 'offered_to_lead') and pg_temp.state_of(v_wq) in ('open', 'offered_to_lead'))::text);
  r := pg_temp.queue_as(v_doc, $a$array['async_question']$a$);
  perform pg_temp.ck('asking for written questions claims the written question, not the more urgent blood pressure review', v_wq::text, (r -> 'task' ->> 'id'));
  perform pg_temp.ck('...the other task is untouched', 'true', (pg_temp.state_of(v_bp) in ('open', 'offered_to_lead'))::text);
  -- no argument keeps the old behaviour (strict class order)
  update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = v_wq and ended_at is null;
  perform private.apply_task_transition(v_wq, 'open', 'system', null, 'proof reset');
  r := pg_temp.queue_as(v_doc, '');
  perform pg_temp.ck('with no argument the more urgent task comes first, as before', v_bp::text, (r -> 'task' ->> 'id'));
end $$;

-- 2b. Call tasks a clinician holds -------------------------------------------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_cmo uuid := pg_temp.f('cmo'); v_pat3 uuid := pg_temp.f('pat3'); v_t uuid; r jsonb;
begin
  perform pg_temp.clear_queue();
  v_t := private.create_clinical_task(v_pat3, 'written_question_call');
  perform pg_temp.ck('a clinician with no claim holds no call tasks', '0', pg_temp.q_as(v_doc, $q$select jsonb_array_length(public.my_held_call_tasks())::text$q$));
  r := pg_temp.queue_as(v_doc, $a$array['written_question_call']$a$);
  perform pg_temp.ck('the call task is claimed by type', v_t::text, (r -> 'task' ->> 'id'));
  perform pg_temp.ck('...and appears in the clinician''s held call tasks', 'true',
    (pg_temp.q_as(v_doc, 'select public.my_held_call_tasks()::text') like '%' || v_t::text || '%')::text);
  perform pg_temp.ck('...but not in another clinician''s', '0', pg_temp.q_as(v_cmo, $q$select jsonb_array_length(public.my_held_call_tasks())::text$q$));
end $$;

-- 3. Idempotent submit --------------------------------------------------------------------------------------------------
do $$
declare
  v_admin uuid := pg_temp.f('admin'); v_p uuid := pg_temp.f('pat3'); v_c uuid := gen_random_uuid(); a text; b text; c text;
begin
  perform pg_temp.ck('a pilot member is granted for the retry checks', 'ok',
    pg_temp.try_as(v_admin, format($q$select public.grant_membership(%L, null, 'Pilot member so the retry proof can send')$q$, v_p)));
  a := pg_temp.submit(v_p, 'First send of the same question', v_c);
  b := pg_temp.submit(v_p, 'First send of the same question', v_c);
  perform pg_temp.ck('a retry with the same client id returns the first question', 'true', (a = b and a ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.ck('...and only one question exists', '1', (select count(*)::text from public.async_consults where patient_id = v_p and client_id = v_c));
  perform pg_temp.ck('...and the allowance counted it once', '1', pg_temp.q_as(v_p, $q$select (public.my_written_question_allowance() ->> 'used')$q$));
  c := pg_temp.submit(v_p, 'A second, different question', gen_random_uuid());
  perform pg_temp.ck('a different client id is a new question', 'true', (c <> a)::text);
  perform pg_temp.ck('registering the same photo twice returns the same photo', 'true',
    (pg_temp.q_as(v_p, format($q$select public.attach_written_question_photo(%L, %L, 'image/jpeg', 1000)::text$q$, a::uuid, v_p::text || '/' || a || '/one.jpg'))
      = pg_temp.q_as(v_p, format($q$select public.attach_written_question_photo(%L, %L, 'image/jpeg', 1000)::text$q$, a::uuid, v_p::text || '/' || a || '/one.jpg')))::text);
  perform pg_temp.ck('a send with no client id still works', 'true', (pg_temp.submit(v_p, 'A third question without an id') ~ '^[0-9a-f-]{36}$')::text);
end $$;

-- 4. SABOTAGE: membership always true, and the retry check removed; both checks must flip -------------------------------
create or replace function private.patient_is_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;
create or replace function public.submit_written_question(p_category text, p_question text, p_duration_note text default null, p_client_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_id uuid := gen_random_uuid();
begin
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient';
  insert into public.async_consults (id, organisation_id, patient_id, category, question, duration_note)
  values (v_id, v_org, v_uid, p_category, btrim(p_question), p_duration_note);
  return v_id;
end $$;

do $$
declare v_p4 uuid := pg_temp.mkuser(pg_temp.f('org'), 'pat4', 'patient'); v_c uuid := gen_random_uuid(); a text; b text;
begin
  insert into results values ('sabotaged', 'a non-member cannot send a written question', 'refused',
    case when pg_temp.submit(v_p4, 'My knee has been swollen for two days') like 'ERR:Written messages%' then 'refused' else 'accepted' end);
  a := pg_temp.submit(v_p4, 'Same question sent twice by a retry', v_c);
  b := pg_temp.submit(v_p4, 'Same question sent twice by a retry', v_c);
  insert into results values ('sabotaged', 'a retry returns the first question', 'same', case when a = b then 'same' else 'different' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S22b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
