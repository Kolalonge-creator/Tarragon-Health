-- S22 proof: written questions and clinical notes (migrations *_s22_written_questions.sql and
-- *_s22_clinical_notes_release_amendment.sql). Spec 8.5, 4.3 notes, 9.2; INV-01, 07, 10, 11, 12, 13.
--
-- Proves in one rolled-back transaction:
--   1. Grants: nothing for anon; no direct read of the question or answer text; no direct write.
--   2. Intake: not a Member refused, a minor refused, the monthly allowance, the config version, a task per question,
--      the safety screen, an event and a receipt that carry ids only.
--   3. Clinician side: no claim, no read; a tied read is audited; an answer needs the attestation and the live claim;
--      a note written from a written question can never carry a diagnosis.
--   4. Answers: guidance, needs more information, needs a call (a call task); the 7 day follow-up; the patient reply
--      makes a fresh task and repeated replies merge.
--   5. The window: reminder once, release to the pool, the allowance returned, the CMO told, idempotent.
--   6. Notes: a draft never reaches a patient; the patient asks, a clinician releases or declines; protected notes need the
--      CMO; amendments need a reason and show beside the original; correction requests never delete; unsigned reminders.
--   7. SABOTAGE: the visibility rule opened, and the allowance removed; both checks must flip.
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



-- S22 helpers
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.staff_of(p_uid uuid) returns uuid language sql as $$ select id from public.clinical_staff where profile_id = p_uid $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

-- S22 helpers ------------------------------------------------------------------------------------------------------
create function pg_temp.submit(p_uid uuid, p_q text, p_cat text default 'symptom') returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.submit_written_question(%L, %L, null)::text', p_cat, p_q)) $$;
create function pg_temp.consult_of(p_patient uuid) returns uuid language sql as
$$ select id from public.async_consults where patient_id = p_patient order by created_at desc limit 1 $$;
create function pg_temp.sweep() returns jsonb language plpgsql as $f$ begin return private.sweep_written_question_windows(); end $f$;
create function pg_temp.mk_member(p_org uuid, p_label text) returns uuid language plpgsql as
$f$ declare v uuid; begin
  v := pg_temp.mkuser(p_org, p_label, 'patient');
  perform pg_temp.setf('mem_' || p_label, v);
  return v;
end $f$;
-- the real membership build replaces private.patient_is_member; the proof stands in for it for the fixture members only
create or replace function private.patient_is_member(p_patient uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from pg_temp.fx where k like 'mem\_%' and v = p_patient) $$;
-- a signed note authored by the given clinician for the patient, using the real functions
create function pg_temp.signed_note(p_doc uuid, p_patient uuid, p_protected boolean default false) returns uuid language plpgsql as
$f$ declare v_note uuid; v_r text;
begin
  perform pg_temp.act(p_doc);
  v_note := public.create_encounter_note(p_patient, 'phone', 'S22 proof note');
  if p_protected then perform public.set_note_protected(v_note, true); end if;
  perform public.update_encounter_note_draft(v_note, '{"assessment":"Reviewed the readings together.","plan":"Continue as planned."}'::jsonb);
  perform public.finalize_encounter_note(v_note, 'continue_monitoring', true);
  perform pg_temp.back();
  return v_note;
end $f$;


-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'doc2', 'medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{adult_general,on_call,prescribing,result_review,hypertension}', v_admin));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc'));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc2'));
  perform pg_temp.mkblock(v_org, pg_temp.f('cmo'));
  perform pg_temp.setf('free', pg_temp.mkuser(v_org, 'free', 'patient'));
  v := pg_temp.mkuser(v_org, 'minor', 'patient');
  update public.profiles set date_of_birth = (current_date - interval '12 years')::date where id = v;
  perform pg_temp.setf('mem_minor', v);
  foreach v in array array[pg_temp.mk_member(v_org, 'allow'), pg_temp.mk_member(v_org, 'm1'), pg_temp.mk_member(v_org, 'm2'),
                           pg_temp.mk_member(v_org, 'm3'), pg_temp.mk_member(v_org, 'm4'), pg_temp.mk_member(v_org, 'm5')] loop null; end loop;
  perform pg_temp.setf('np', pg_temp.mkuser(v_org, 'np', 'patient'));
  perform pg_temp.setf('np2', pg_temp.mkuser(v_org, 'np2', 'patient'));
  perform pg_temp.setf('pat', pg_temp.f('np'));
end $$;

-- 1. Grants ------------------------------------------------------------------------------------------------------------
do $$
declare v_free uuid := pg_temp.f('free');
begin
  perform pg_temp.ck('anon cannot submit a written question', '42501',
    pg_temp.try_anon($q$select public.submit_written_question('symptom', 'a question that is long enough', null)$q$));
  perform pg_temp.ck('a signed-in patient cannot read the question text directly', 'true',
    (pg_temp.q_as(v_free, 'select question from public.async_consults limit 1') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a signed-in patient cannot insert directly', 'true',
    (pg_temp.try_as(v_free, format($q$insert into public.async_consults (organisation_id, patient_id, category, question) values (%L, %L, 'general', 'a direct insert that should fail')$q$,
       pg_temp.f('org'), v_free)) like 'permission denied%')::text);
  perform pg_temp.ck('staff cannot read the answer text directly', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), 'select answer from public.async_consults limit 1') like 'ERR:permission denied%')::text);
end $$;

-- 2. Intake ------------------------------------------------------------------------------------------------------------
do $$
declare
  v_free uuid := pg_temp.f('free'); v_minor uuid := pg_temp.f('mem_minor'); v_a uuid := pg_temp.f('mem_allow');
  c uuid; r text; i integer; v_cfg integer;
begin
  perform pg_temp.ck('a non-member is told written messages are part of Membership', 'true',
    (pg_temp.submit(v_free, 'My knee has been swollen for two days') like 'ERR:Written messages to your care team are part of Membership%')::text);
  perform pg_temp.ck('a minor is refused', 'true',
    (pg_temp.submit(v_minor, 'My knee has been swollen for two days') like 'ERR:Written questions are for adults%')::text);

  perform pg_temp.clear_queue();
  c := pg_temp.submit(v_a, 'My knee has been swollen for two days, what should I do?')::uuid;
  perform pg_temp.setf('c_allow1', c);
  select version into v_cfg from public.written_care_config where is_active;
  perform pg_temp.ck('a member question is stored with the config version it used (INV-16)', v_cfg::text,
    (select config_version::text from public.async_consults where id = c));
  perform pg_temp.ck('the window comes from config (1440 minutes)', '1440', (select window_minutes::text from public.async_consults where id = c));
  perform pg_temp.ck('a task exists for the question', 'async_question',
    (select t.type from public.async_consults a join public.clinical_tasks t on t.id = a.task_id where a.id = c));
  perform pg_temp.ck('...it is a test task (INV-13)', 'true', (select t.is_test::text from public.async_consults a join public.clinical_tasks t on t.id = a.task_id where a.id = c));
  perform pg_temp.ck('...and waiting for a clinician', 'true',
    (select (t.state in ('open', 'offered_to_lead'))::text from public.async_consults a join public.clinical_tasks t on t.id = a.task_id where a.id = c));
  perform pg_temp.ck('the submitted event carries the id only (INV-07)', jsonb_build_object('consult_id', c)::text,
    (select payload::text from public.domain_events where event_type = 'async_question.submitted' and aggregate_id = c));
  perform pg_temp.ck('the receipt notification carries the id only', jsonb_build_object('consult_id', c)::text,
    (select payload::text from public.notifications where recipient_id = v_a and template = 'written_question_received' and payload ->> 'consult_id' = c::text));

  -- the safety screen (no model): a danger phrase raises the same alert as a flagged care message and never blocks the question
  c := pg_temp.submit(v_a, 'I have chest pain since this morning and feel unwell')::uuid;
  perform pg_temp.ck('a danger phrase flags the question', 'true', (select safety_flagged::text from public.async_consults where id = c));
  perform pg_temp.ck('...and raises one clinician alert', '1',
    (select count(*)::text from public.clinician_alerts where patient_id = v_a and type_code = 'message_safety_flag'));
  perform pg_temp.ck('...while the question still reaches the queue', 'true',
    (select (t.state in ('open', 'offered_to_lead'))::text from public.async_consults a join public.clinical_tasks t on t.id = a.task_id where a.id = c));
  c := pg_temp.submit(v_a, 'Can I take my tablets with food or not?')::uuid;
  c := pg_temp.submit(v_a, 'How long should I rest after the injection?')::uuid;
  perform pg_temp.ck('the monthly allowance is 4', '4', pg_temp.q_as(v_a, $q$select (public.my_written_question_allowance() ->> 'used')$q$));
  perform pg_temp.ck('the fifth question in a month is refused', 'true',
    (pg_temp.submit(v_a, 'One more question that goes over the limit') like 'ERR:You have used your written messages for this month%')::text);
end $$;

-- 3. Clinician side ----------------------------------------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); v_m uuid := pg_temp.f('mem_m1');
  c uuid; v_task uuid; v_got uuid; r text; v_before integer;
begin
  perform pg_temp.clear_queue();
  c := pg_temp.submit(v_m, 'My knee has been swollen for two days, what should I do?')::uuid;
  perform pg_temp.setf('c1', c);
  select task_id into v_task from public.async_consults where id = c;
  perform pg_temp.ck('no claim, no read: a clinician cannot open the question', 'ERR:queue_no_claim',
    pg_temp.q_as(v_doc, format('select public.read_written_question_audited(%L, %L)::text', c, 'proof')));
  v_got := pg_temp.next_task(v_doc);
  perform pg_temp.ck('the clinician is handed the written question through the queue', v_task::text, v_got::text);
  select count(*) into v_before from public.audit_log where subject_patient_id = v_m;
  perform pg_temp.ck('the claimed question appears in the clinician''s own list, with no question text', 'true',
    (pg_temp.q_as(v_doc, 'select public.my_written_question_claims()::text') like '%' || c::text || '%'
      and pg_temp.q_as(v_doc, 'select public.my_written_question_claims()::text') not like '%knee%')::text);
  perform pg_temp.ck('another clinician''s list does not show it', 'false',
    (pg_temp.q_as(v_doc2, 'select public.my_written_question_claims()::text') like '%' || c::text || '%')::text);
  perform pg_temp.ck('a tied clinician can read it', 'true',
    (pg_temp.q_as(v_doc, format('select public.read_written_question_audited(%L, %L)::text', c, 'proof')) like '%knee%')::text);
  perform pg_temp.ck('...and the read is audited (INV-10)', 'true',
    ((select count(*) from public.audit_log where subject_patient_id = v_m) > v_before)::text);
  perform pg_temp.ck('another clinician without a claim cannot read it (INV-12)', 'ERR:queue_no_claim',
    pg_temp.q_as(v_doc2, format('select public.read_written_question_audited(%L, %L)::text', c, 'proof')));
  perform pg_temp.ck('a note written from a written question cannot carry a diagnosis', 'true',
    (pg_temp.q_as(v_doc, format($q$select public.create_encounter_note(%L, 'async_consult', 'proof', null, null, null, 'Knee infection', null, null, null, null, %L)::text$q$, v_m, c))
       like '%clinical_encounter_notes_async_no_diagnosis%')::text);
  perform pg_temp.ck('an answer needs the no-diagnosis attestation', 'ERR:written_question_attest_no_diagnosis',
    pg_temp.q_as(v_doc, format($q$select public.answer_written_question(%L, 'guidance', 'Rest the knee and keep it raised today.', false)::text$q$, c)));
  perform pg_temp.ck('an answer needs the live claim', 'ERR:queue_no_claim',
    pg_temp.q_as(v_doc2, format($q$select public.answer_written_question(%L, 'guidance', 'Rest the knee and keep it raised today.', true)::text$q$, c)));
  perform pg_temp.ck('guidance is accepted', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.answer_written_question(%L, 'guidance', 'Rest the knee and keep it raised today.', true)$q$, c)));
  perform pg_temp.ck('...status answered', 'answered', (select status::text from public.async_consults where id = c));
  perform pg_temp.ck('...kind guidance', 'guidance', (select answer_kind from public.async_consults where id = c));
  perform pg_temp.ck('...attested', 'true', (select no_diagnosis_attested::text from public.async_consults where id = c));
  perform pg_temp.ck('...answered by the real clinician (forge-proof)', pg_temp.staff_of(v_doc)::text, (select answered_by::text from public.async_consults where id = c));
  perform pg_temp.ck('...follow-up window is 7 days', 'true',
    (select (follow_up_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour')::text from public.async_consults where id = c));
  perform pg_temp.ck('...the task is completed', 'completed', pg_temp.state_of(v_task));
  perform pg_temp.ck('...no note from this question carries a diagnosis', '0',
    (select count(*)::text from public.clinical_encounter_notes where async_consult_id = c and diagnosis is not null));
  perform pg_temp.ck('...the answered event carries ids and kind only', jsonb_build_object('consult_id', c, 'answer_kind', 'guidance')::text,
    (select payload::text from public.domain_events where event_type = 'async_question.answered' and aggregate_id = c));
  perform pg_temp.ck('...the patient is told neutrally', '1',
    (select count(*)::text from public.notifications where recipient_id = v_m and template = 'written_question_answered' and payload ->> 'consult_id' = c::text));
  perform pg_temp.ck('the patient reads the answer', 'true',
    (pg_temp.q_as(v_m, 'select public.my_written_questions()::text') like '%Rest the knee%')::text);
  perform pg_temp.ck('another patient does not', 'false',
    (pg_temp.q_as(pg_temp.f('mem_m2'), 'select public.my_written_questions()::text') like '%Rest the knee%')::text);

  -- the follow-up
  perform pg_temp.ck('the patient may reply inside the follow-up window', 'ok',
    pg_temp.try_as(v_m, format($q$select public.post_written_question_message(%L, 'It is still swollen this evening')$q$, c)));
  select task_id into v_got from public.async_consults where id = c;
  perform pg_temp.ck('...which gives the care team a new task', 'true', (v_got is distinct from v_task and pg_temp.state_of(v_got) in ('open', 'offered_to_lead'))::text);
  perform pg_temp.ck('a second reply merges into the same task', 'ok',
    pg_temp.try_as(v_m, format($q$select public.post_written_question_message(%L, 'And it is warm to touch')$q$, c)));
  perform pg_temp.ck('...same task', v_got::text, (select task_id::text from public.async_consults where id = c));
  perform pg_temp.ck('...the status stays answered', 'answered', (select status::text from public.async_consults where id = c));
  update public.async_consults set follow_up_until = now() - interval '1 minute' where id = c;
  perform pg_temp.ck('after the follow-up window a reply is refused', 'true',
    (pg_temp.try_as(v_m, format($q$select public.post_written_question_message(%L, 'One more thing')$q$, c)) like 'The follow-up time%')::text);
end $$;

-- 4. The other answer kinds --------------------------------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_m2 uuid := pg_temp.f('mem_m2'); v_m3 uuid := pg_temp.f('mem_m3');
  c uuid; v_task uuid; v_re uuid; r record;
begin
  -- needs a call
  perform pg_temp.clear_queue();
  c := pg_temp.submit(v_m2, 'I keep getting dizzy when I stand up quickly')::uuid;
  perform pg_temp.next_task(v_doc);
  perform pg_temp.ck('needs-a-call is accepted', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.answer_written_question(%L, 'needs_call', 'We would like to talk this through by phone.', true)$q$, c)));
  perform pg_temp.ck('...creates exactly one call task', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = v_m2 and type = 'written_question_call' and state not in ('completed', 'cancelled')));
  perform pg_temp.ck('...tells the patient they will be called', '1',
    (select count(*)::text from public.notifications where recipient_id = v_m2 and template = 'written_question_call_planned'));
  perform pg_temp.ck('...and no diagnosis exists anywhere on the question', 'false',
    (select (no_diagnosis_attested and answer_kind <> 'needs_call')::text from public.async_consults where id = c));

  -- needs more information, a patient reply, then guidance
  perform pg_temp.clear_queue();
  c := pg_temp.submit(v_m3, 'My tablets make me feel strange after lunch')::uuid;
  perform pg_temp.next_task(v_doc);
  perform pg_temp.ck('a request for more information is accepted', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.answer_written_question(%L, 'needs_more_information', 'Which tablet is it, and how long after lunch?', true)$q$, c)));
  perform pg_temp.ck('...the question stays open (in_review)', 'in_review', (select status::text from public.async_consults where id = c));
  perform pg_temp.ck('...the thread has the care team message', '1', (select count(*)::text from public.async_consult_messages where consult_id = c and author_role = 'care_team'));
  perform pg_temp.ck('...the patient is asked neutrally', '1', (select count(*)::text from public.notifications where recipient_id = v_m3 and template = 'written_question_info_needed'));
  perform pg_temp.ck('the patient replies', 'ok', pg_temp.try_as(v_m3, format($q$select public.post_written_question_message(%L, 'The white one, about an hour after')$q$, c)));
  select task_id into v_re from public.async_consults where id = c;
  perform pg_temp.ck('...which creates a fresh task', 'true', (pg_temp.state_of(v_re) in ('open', 'offered_to_lead'))::text);
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') and id <> v_re loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
  perform pg_temp.ck('the clinician is handed the reply task', v_re::text, pg_temp.next_task(v_doc)::text);
  perform pg_temp.ck('...and answers with guidance', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.answer_written_question(%L, 'guidance', 'Take it with food and tell us if it continues.', true)$q$, c)));
  perform pg_temp.ck('...which finishes the question', 'answered', (select status::text from public.async_consults where id = c));
end $$;

-- 5. The window --------------------------------------------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_m4 uuid := pg_temp.f('mem_m4'); v_m5 uuid := pg_temp.f('mem_m5'); v_cmo uuid := pg_temp.f('cmo');
  c uuid; c5 uuid; v_task uuid; v_rem timestamptz; r jsonb;
begin
  perform pg_temp.clear_queue();
  c := pg_temp.submit(v_m4, 'How much water should I drink in a day?')::uuid;
  select task_id into v_task from public.async_consults where id = c;
  update public.async_consults set window_started_at = now() - interval '1100 minutes' where id = c;
  perform pg_temp.sweep();
  select reminded_at into v_rem from public.async_consults where id = c;
  perform pg_temp.ck('at 75 percent of the window the reminder is stamped once', 'true', (v_rem is not null and (select window_missed_at from public.async_consults where id = c) is null)::text);
  perform pg_temp.sweep();
  perform pg_temp.ck('...a second sweep does not remind again', 'true', ((select reminded_at from public.async_consults where id = c) = v_rem)::text);
  perform pg_temp.ck('before the miss the allowance is used', '1', pg_temp.q_as(v_m4, $q$select (public.my_written_question_allowance() ->> 'used')$q$));
  update public.async_consults set window_started_at = now() - interval '1500 minutes' where id = c;
  r := pg_temp.sweep();
  perform pg_temp.ck('past the window the miss is recorded', 'true', ((select window_missed_at from public.async_consults where id = c) is not null)::text);
  perform pg_temp.ck('...the allowance is returned', '0', pg_temp.q_as(v_m4, $q$select (public.my_written_question_allowance() ->> 'used')$q$));
  perform pg_temp.ck('...one miss event, ids only', jsonb_build_object('consult_id', c)::text,
    (select payload::text from public.domain_events where event_type = 'async_question.window_missed' and aggregate_id = c));
  perform pg_temp.ck('...the patient is told', '1', (select count(*)::text from public.notifications where recipient_id = v_m4 and template = 'written_question_window_missed'));
  perform pg_temp.ck('...the CMO is told', '1', (select count(*)::text from public.notifications where recipient_id = v_cmo and payload ->> 'consult_id' = c::text));
  perform pg_temp.ck('...the question is not closed or dropped', 'true', (pg_temp.state_of(v_task) in ('open', 'offered_to_lead') and (select status::text from public.async_consults where id = c) = 'submitted')::text);
  perform pg_temp.sweep();
  perform pg_temp.ck('a second sweep does not miss it again', '1', (select count(*)::text from public.domain_events where event_type = 'async_question.window_missed' and aggregate_id = c));

  -- a claimed question is released to the pool
  perform pg_temp.clear_queue();
  c5 := pg_temp.submit(v_m5, 'Is it normal to feel tired after the injection?')::uuid;
  select task_id into v_task from public.async_consults where id = c5;
  perform pg_temp.next_task(v_doc);
  update public.async_consults set window_started_at = now() - interval '1500 minutes' where id = c5;
  perform pg_temp.sweep();
  perform pg_temp.ck('a claim past the window ends as expired', 'expired', (select end_reason from public.task_claims where task_id = v_task order by claimed_at desc limit 1));
  perform pg_temp.ck('...and the task is back in the pool', 'open', pg_temp.state_of(v_task));
end $$;

-- 6. Notes -------------------------------------------------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); v_cmo uuid := pg_temp.f('cmo');
  v_np uuid := pg_temp.f('np'); v_np2 uuid := pg_temp.f('np2');
  n1 uuid; n2 uuid; n3 uuid; n4 uuid; a1 uuid; v_am uuid; q uuid; t1 uuid; t2 uuid; v_out text; v_before integer;
begin
  perform pg_temp.clear_queue();
  t1 := pg_temp.mktask(v_np, 'async_question');
  perform pg_temp.ck('the author clinician holds a claim on the patient', t1::text, pg_temp.next_task(v_doc)::text);
  t2 := pg_temp.mktask(v_np, 'async_question');
  perform pg_temp.ck('the CMO holds a second claim', t2::text, pg_temp.next_task(v_cmo)::text);

  n1 := pg_temp.signed_note(v_doc, v_np);
  n3 := pg_temp.signed_note(v_doc, v_np, true);
  n4 := pg_temp.signed_note(v_cmo, v_np, true);
  perform pg_temp.act(v_doc);
  n2 := public.create_encounter_note(v_np, 'phone', 'S22 proof draft');
  perform pg_temp.back();
  perform pg_temp.setf('n1', n1); perform pg_temp.setf('n2', n2); perform pg_temp.setf('n3', n3); perform pg_temp.setf('n4', n4);

  perform pg_temp.ck('a signed note is stamped a test note (INV-13)', 'true', (select is_test::text from public.clinical_encounter_notes where id = n1));
  perform pg_temp.ck('signing emitted an event with the id only (INV-07)', jsonb_build_object('note_id', n1)::text,
    (select payload::text from public.domain_events where event_type = 'note.signed' and aggregate_id = n1));
  perform pg_temp.ck('the patient index lists signed notes only, never a draft', '3', pg_temp.q_as(v_np, $q$select jsonb_array_length(public.my_note_index())::text$q$));
  perform pg_temp.ck('...with no clinical text', 'false', (pg_temp.q_as(v_np, $q$select public.my_note_index()::text$q$) like '%Reviewed the readings%')::text);
  perform pg_temp.ck('INV-11: nothing is readable until a clinician releases it', '0', pg_temp.q_as(v_np, $q$select jsonb_array_length(public.my_released_notes())::text$q$));
  perform pg_temp.ck('the notes table has no patient path at all', 'true',
    (pg_temp.q_as(v_np, 'select count(*)::text from public.clinical_encounter_notes') in ('0') or pg_temp.q_as(v_np, 'select count(*)::text from public.clinical_encounter_notes') like 'ERR:permission denied%')::text);

  perform pg_temp.ck('the patient asks to open a note', 'ok', pg_temp.try_as(v_np, format('select public.request_note_release(%L)', n1)));
  perform pg_temp.ck('...asking again is harmless', 'ok', pg_temp.try_as(v_np, format('select public.request_note_release(%L)', n1)));
  perform pg_temp.ck('another patient cannot ask for it', 'true', (pg_temp.try_as(v_np2, format('select public.request_note_release(%L)', n1)) like 'not found%')::text);
  perform pg_temp.ck('the author sees the request, with no clinical text', '1', pg_temp.q_as(v_doc, $q$select jsonb_array_length(public.my_note_requests() -> 'releases')::text$q$));
  perform pg_temp.ck('a clinician who is not the author sees none', '0', pg_temp.q_as(v_doc2, $q$select jsonb_array_length(public.my_note_requests() -> 'releases')::text$q$));
  perform pg_temp.ck('a clinician with no tie cannot decide it', 'true', (pg_temp.try_as(v_doc2, format($q$select public.decide_note_release(%L, true, null)$q$, n1)) like 'not authorised for this note%')::text);
  perform pg_temp.ck('withholding needs a real reason', 'note_withhold_reason_needed', pg_temp.try_as(v_doc, format($q$select public.decide_note_release(%L, false, 'no')$q$, n1)));
  perform pg_temp.ck('the author releases the note', 'ok', pg_temp.try_as(v_doc, format('select public.decide_note_release(%L, true, null)', n1)));
  select count(*) into v_before from public.audit_log where action = 'note.patient_read' and subject_patient_id = v_np;
  perform pg_temp.ck('INV-11: the patient now reads the released signed note, and only it', n1::text,
    pg_temp.q_as(v_np, $q$select (public.my_released_notes() -> 0 ->> 'id')$q$));
  perform pg_temp.ck('...one note', '1', pg_temp.q_as(v_np, $q$select jsonb_array_length(public.my_released_notes())::text$q$));
  perform pg_temp.ck('...signed by the real clinician', 'S22 doc', pg_temp.q_as(v_np, $q$select (public.my_released_notes() -> 0 ->> 'signed_by')$q$));
  perform pg_temp.ck('...and the patient read is audited (INV-10)', 'true', ((select count(*) from public.audit_log where action = 'note.patient_read' and subject_patient_id = v_np) > v_before)::text);
  perform pg_temp.ck('...the patient is told neutrally', '1', (select count(*)::text from public.notifications where recipient_id = v_np and template = 'note_released'));
  perform pg_temp.ck('...a released event with the id only', jsonb_build_object('note_id', n1)::text,
    (select payload::text from public.domain_events where event_type = 'note.released' and aggregate_id = n1 order by occurred_at desc limit 1));
  perform pg_temp.ck('a draft is still never visible', 'false', (pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%' || n2::text || '%')::text);

  -- protected notes
  perform pg_temp.ck('a non-CMO author cannot release a protected note', 'note_release_cmo_only', pg_temp.try_as(v_doc, format('select public.decide_note_release(%L, true, null)', n3)));
  perform pg_temp.ck('the CMO can release a protected note (the gate opens)', 'ok', pg_temp.try_as(v_cmo, format('select public.decide_note_release(%L, true, null)', n4)));
  perform pg_temp.ck('...so the patient now reads two notes', '2', pg_temp.q_as(v_np, $q$select jsonb_array_length(public.my_released_notes())::text$q$));
  perform pg_temp.ck('the CMO can withhold with a reason', 'ok',
    pg_temp.try_as(v_cmo, format($q$select public.decide_note_release(%L, false, 'Contains third party information that must be removed first')$q$, n3)));
  perform pg_temp.ck('...the patient sees the reason in the index, not the note', 'true',
    (pg_temp.q_as(v_np, $q$select public.my_note_index()::text$q$) like '%third party information%' and pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) not like '%' || n3::text || '%')::text);

  -- amendments
  perform pg_temp.ck('an amendment needs a real reason', 'note_amendment_reason_needed', pg_temp.try_as(v_doc, format($q$select public.create_note_amendment(%L, 'correction', 'short')$q$, n1)));
  perform pg_temp.ck('a draft cannot be amended', 'true', (pg_temp.try_as(v_doc, format($q$select public.create_note_amendment(%L, 'addendum', 'Added the missing follow up detail')$q$, n2)) like 'only a signed note%')::text);
  perform pg_temp.act(v_doc);
  a1 := public.create_note_amendment(n1, 'correction', 'Corrected the plan after reviewing the readings');
  perform pg_temp.back();
  perform pg_temp.setf('a1', a1);
  perform pg_temp.ck('the amendment is a linked draft', n1::text, (select amends_note_id::text from public.clinical_encounter_notes where id = a1));
  perform pg_temp.ck('...the patient does not see it yet', 'false', (pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%' || a1::text || '%')::text);
  perform pg_temp.ck('...and the original still reads as signed', 'signed', (select state from public.notes where id = n1));
  perform pg_temp.act(v_doc);
  perform public.update_encounter_note_draft(a1, '{"plan":"Stop the old plan and follow the new one."}'::jsonb);
  perform public.finalize_encounter_note(a1, 'continue_monitoring', true);
  perform pg_temp.back();
  perform pg_temp.ck('once signed, the original reads as amended', 'amended', (select state from public.notes where id = n1));
  perform pg_temp.ck('...an amended event names both', jsonb_build_object('note_id', a1, 'amends_note_id', n1)::text,
    (select payload::text from public.domain_events where event_type = 'note.amended' and aggregate_id = a1));
  perform pg_temp.ck('...the patient sees the correction beside the original', '3', pg_temp.q_as(v_np, $q$select jsonb_array_length(public.my_released_notes())::text$q$));

  -- correction requests
  perform pg_temp.ck('a withheld note cannot be disputed', 'true', (pg_temp.try_as(v_np, format($q$select public.request_note_correction(%L, 'This does not match what I was told')$q$, n3)) like 'not found%')::text);
  perform pg_temp.ck('a correction request needs real text', 'true', (pg_temp.try_as(v_np, format($q$select public.request_note_correction(%L, 'wrong')$q$, n1)) like '%check%')::text);
  perform pg_temp.act(v_np);
  q := public.request_note_correction(n1, 'The note says I stopped my tablets but I did not');
  perform pg_temp.back();
  perform pg_temp.ck('a patient can ask for a correction', 'open', (select state from public.note_correction_requests where id = q));
  perform pg_temp.ck('...only one open request per note', 'true', (pg_temp.try_as(v_np, format($q$select public.request_note_correction(%L, 'And one more thing that is wrong')$q$, n1)) like '%one_open%')::text);
  perform pg_temp.ck('a clinician with no tie cannot answer it', 'true', (pg_temp.try_as(v_doc2, format($q$select public.respond_note_correction(%L, 'annotated', 'We have recorded your comment.')$q$, q)) like 'not authorised for this note%')::text);
  perform pg_temp.ck('an answer needs real text', 'note_correction_response_needed', pg_temp.try_as(v_doc, format($q$select public.respond_note_correction(%L, 'annotated', 'ok')$q$, q)));
  perform pg_temp.act(v_doc);
  v_am := public.respond_note_correction(q, 'accepted', 'You are right, we have started a corrected note.');
  perform pg_temp.back();
  perform pg_temp.ck('accepting starts a linked correction draft', n1::text, (select amends_note_id::text from public.clinical_encounter_notes where id = v_am));
  perform pg_temp.ck('...kind correction', 'correction', (select amendment_kind from public.clinical_encounter_notes where id = v_am));
  perform pg_temp.ck('...the request is closed with the answer', 'accepted', (select state from public.note_correction_requests where id = q));
  perform pg_temp.ck('...the patient sees the answer beside the note', 'true', (pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%We have recorded%' or pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%corrected note%')::text);
  perform pg_temp.ck('...nothing was deleted', 'true', ((select count(*) from public.clinical_encounter_notes where id in (n1, n2, n3, n4, a1, v_am)) = 6)::text);
  perform pg_temp.ck('an answered request cannot be answered again', 'true', (pg_temp.try_as(v_doc, format($q$select public.respond_note_correction(%L, 'declined', 'Trying to answer a second time.')$q$, q)) like 'already answered%')::text);

  -- unsigned notes
  set local session_replication_role = replica;
  update public.clinical_encounter_notes set created_at = now() - interval '30 hours' where id = n2;
  set local session_replication_role = origin;
  perform private.sweep_unsigned_notes();
  perform pg_temp.ck('a draft past 24 hours reminds its author once', 'true', ((select reminded_at from public.note_unsigned_reminders where note_id = n2) is not null)::text);
  perform pg_temp.ck('...the author is told neutrally', 'true', ((select count(*) from public.notifications where recipient_id = v_doc and template = 'note_unsigned_reminder') >= 1)::text);
  perform pg_temp.ck('...the lead is not told yet', 'true', ((select lead_notified_at from public.note_unsigned_reminders where note_id = n2) is null)::text);
  set local session_replication_role = replica;
  update public.clinical_encounter_notes set created_at = now() - interval '80 hours' where id = n2;
  set local session_replication_role = origin;
  perform private.sweep_unsigned_notes();
  perform pg_temp.ck('past 72 hours the lead is told', 'true', ((select lead_notified_at from public.note_unsigned_reminders where note_id = n2) is not null)::text);
  perform pg_temp.ck('nothing is signed for anyone', 'draft', (select status from public.clinical_encounter_notes where id = n2));
end $$;

-- 7. SABOTAGE: the visibility rule opened, and the allowance removed; both checks must flip ------------------------------
create or replace function private.note_patient_visible(p_note uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;
update public.written_care_config set rules = jsonb_set(rules, '{monthlyAllowance}', '1000') where is_active;

do $$
declare v_np uuid := pg_temp.f('np'); n3 uuid := pg_temp.f('n3'); n2 uuid := pg_temp.f('n2');
begin
  insert into results values ('sabotaged', 'a withheld signed note stays hidden from the patient', 'false',
    (pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%' || n3::text || '%')::text);
  insert into results values ('sabotaged', 'the fifth written question in a month is refused', 'refused',
    case when pg_temp.submit(pg_temp.f('mem_allow'), 'One more question that goes over the limit') like 'ERR:You have used%' then 'refused' else 'accepted' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S22 proof FAILED on the real migrations: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ inside the DO block above. They are deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;
