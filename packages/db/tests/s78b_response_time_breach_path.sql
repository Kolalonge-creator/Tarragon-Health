-- S78b proof: the response-time config and the breach sweep (migration *_s78b_response_time_config_and_breach_path.sql; CMO decision S-9).
--
-- Proves in one rolled-back transaction:
--   1. Shape: version 1 is seeded INACTIVE (no numbers are in force); RLS on; authenticated only SELECT; anon nothing; a bad config is refused.
--   2. With NO active config the sweep reads nothing and flags nothing, even for a question and an amber review that are days late
--      (the numbers sitting in the inactive version are never read).
--   3. With an ACTIVE version the sweep flags exactly the late written question, amber review and appointment start (and not the on-time
--      ones, not a test patient's, not a finished one), records one breach each, opens one sev3 incident per kind, tells the clinical lead in
--      neutral words, and sends the patient one plain notice (no number, no condition), at most one per cooldown.
--   4. Idempotent: a second sweep adds nothing.
--   5. Reads: the lead and admin see counts; a patient and anon are refused; a patient reads no breach row.
--   6. SABOTAGE: make the sweep ignore the active flag; with no active config it would now flag, so the check in 2 would have failed.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's78b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S78b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en')
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician', false);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S78b ' || p_label, 'MDCN', 'S78B-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, false);
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_pt_late uuid; v_pt_ok uuid; v_pt_test uuid; v_pt_amber uuid; v_pt_appt uuid;
  q_late uuid; q_ok uuid; q_test uuid; q_answered uuid; t_late uuid; t_ok uuid; a_late uuid; a_ok uuid; a_started uuid;
  v_sw jsonb; v_counts jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', false);
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_doc := pg_temp.mkdoc(v_org, v_admin, 'doc', 'senior_medical_officer');
  v_pt_late := pg_temp.mkuser(v_org, 'p-late', 'patient', false);
  v_pt_ok := pg_temp.mkuser(v_org, 'p-ok', 'patient', false);
  v_pt_test := pg_temp.mkuser(v_org, 'p-test', 'patient', true);
  v_pt_amber := pg_temp.mkuser(v_org, 'p-amber', 'patient', false);
  v_pt_appt := pg_temp.mkuser(v_org, 'p-appt', 'patient', false);
  insert into fx values ('admin', v_admin), ('cmo', v_cmo), ('doc', v_doc), ('patient', v_pt_late);

  -- fixtures written with triggers off (the intake gates are not under test here)
  set local session_replication_role = replica;
  insert into public.async_consults (organisation_id, patient_id, category, question, status, is_test, created_at, window_started_at)
    values (v_org, v_pt_late, 'general', 'S78b proof question late', 'submitted', false, now() - interval '30 hours', now() - interval '30 hours') returning id into q_late;
  insert into public.async_consults (organisation_id, patient_id, category, question, status, is_test, created_at, window_started_at)
    values (v_org, v_pt_ok, 'general', 'S78b proof question fresh', 'submitted', false, now() - interval '2 hours', now() - interval '2 hours') returning id into q_ok;
  insert into public.async_consults (organisation_id, patient_id, category, question, status, is_test, created_at, window_started_at)
    values (v_org, v_pt_test, 'general', 'S78b proof question test', 'submitted', true, now() - interval '30 hours', now() - interval '30 hours') returning id into q_test;
  insert into public.async_consults (organisation_id, patient_id, category, question, status, is_test, answered_at, created_at, window_started_at)
    values (v_org, v_pt_ok, 'general', 'S78b proof question answered', 'answered', false, now() - interval '20 hours', now() - interval '30 hours', now() - interval '30 hours') returning id into q_answered;
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test, created_at)
    values (v_org, 'amber_bp_review', 1, 4, 4, v_pt_amber, 'medical_officer', now() - interval '6 hours', 'open', false, now() - interval '30 hours') returning id into t_late;
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test, created_at)
    values (v_org, 'amber_bp_review', 1, 4, 4, v_pt_ok, 'medical_officer', now() + interval '20 hours', 'open', false, now() - interval '4 hours') returning id into t_ok;
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status, appointment_type, consultation_method)
    values (v_org, v_pt_appt, v_doc, now() - interval '70 minutes', now() - interval '45 minutes', 'confirmed', 'telemedicine', 'telemedicine') returning id into a_late;
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status, appointment_type, consultation_method)
    values (v_org, v_pt_ok, v_doc, now() + interval '2 hours', now() + interval '2 hours 30 minutes', 'confirmed', 'telemedicine', 'telemedicine') returning id into a_ok;
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status, appointment_type, consultation_method)
    values (v_org, v_pt_ok, v_doc, now() - interval '40 minutes', now() + interval '10 minutes', 'in_progress', 'telemedicine', 'telemedicine') returning id into a_started;
  set local session_replication_role = origin;

  -- 1. Shape ----------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('version 1 is seeded inactive', 'false', (select is_active::text from public.response_time_config where version = 1));
  perform pg_temp.rec('no config is active', '0', (select count(*)::text from public.response_time_config where is_active));
  perform pg_temp.rec('RLS on for both tables', '2', (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('response_time_config', 'response_time_breaches') and c.relrowsecurity));
  perform pg_temp.rec('authenticated holds only SELECT, anon nothing', '0', (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('response_time_config', 'response_time_breaches') and ((grantee = 'authenticated' and privilege_type <> 'SELECT') or grantee in ('anon', 'PUBLIC'))));
  perform pg_temp.rec('a config missing a key is refused', '23514', pg_temp.try($q$insert into public.response_time_config (version, is_active, effective_from, rules) values (90, false, current_date, '{"written_question_minutes":60}')$q$));
  perform pg_temp.rec('a config with a zero target is refused', '23514', pg_temp.try($q$insert into public.response_time_config (version, is_active, effective_from, rules) values (91, false, current_date, '{"written_question_minutes":0,"amber_review_minutes":1,"appointment_start_late_minutes":1,"lookback_days":1,"patient_notice_cooldown_hours":1}')$q$));

  -- 2. No active config: nothing is read, nothing is flagged -----------------------------------------------------------------------
  v_sw := private.sweep_response_time_breaches();
  perform pg_temp.rec('with no active config the sweep reports inactive', 'false,0', (v_sw ->> 'active') || ',' || (v_sw ->> 'new'));
  perform pg_temp.rec('and records no breach even though items are days late', '0', (select count(*)::text from public.response_time_breaches));
  perform pg_temp.rec('and sends no patient notice', '0', (select count(*)::text from public.notifications where template = 'response_slower_notice'));

  -- 3. Activate a version and sweep --------------------------------------------------------------------------------------------------
  update public.response_time_config set is_active = true where version = 1;
  v_sw := private.sweep_response_time_breaches();
  perform pg_temp.rec('three late items are flagged', '3', v_sw ->> 'new');
  perform pg_temp.rec('the late written question, amber review and appointment start each have one breach', 'amber_review,appointment_start,written_question',
    (select string_agg(kind, ',' order by kind) from public.response_time_breaches where subject_id in (q_late, t_late, a_late)));
  perform pg_temp.rec('the on-time, answered, started and test items have none', '0', (select count(*)::text from public.response_time_breaches where subject_id in (q_ok, q_test, q_answered, t_ok, a_ok, a_started)));
  perform pg_temp.rec('the breach records the config version', '1', (select min(config_version)::text from public.response_time_breaches));
  perform pg_temp.rec('one open sev3 incident per kind', '3,sev3', (select count(*)::text || ',' || min(severity::text) from public.ops_incidents where external_reference like 'response_time_breach:%:' || v_org and status not in ('resolved', 'closed')));
  perform pg_temp.rec('each late patient got one plain notice', '3', (select count(*)::text from public.notifications where template = 'response_slower_notice' and recipient_id in (v_pt_late, v_pt_amber, v_pt_appt)));
  perform pg_temp.rec('the notice carries no payload, no number, no condition (INV-07)', '0', (select count(*)::text from public.notifications where template = 'response_slower_notice' and payload <> '{}'::jsonb));
  perform pg_temp.rec('the template text names no number or condition', '0', (select count(*)::text from public.notification_template_locales where template_key = 'response_slower_notice' and (body ~ '[0-9]' or body ~* 'pressure|diabet|result|reading|medicine')));
  perform pg_temp.rec('the clinical lead was told once for the organisation', 'true',
    (select (count(*) = 1)::text from public.notifications where recipient_id = v_cmo and created_at >= now() - interval '1 minute' and payload::text !~* 'patient|question|chest'));

  -- 4. Idempotent -----------------------------------------------------------------------------------------------------------------------
  v_sw := private.sweep_response_time_breaches();
  perform pg_temp.rec('a second sweep flags nothing new and sends nothing more', '0,3', (v_sw ->> 'new') || ',' || (select count(*)::text from public.notifications where template = 'response_slower_notice'));
  -- one patient, two late items inside the cooldown: one notice only
  set local session_replication_role = replica;
  insert into public.async_consults (organisation_id, patient_id, category, question, status, is_test, created_at, window_started_at)
    values (v_org, v_pt_late, 'general', 'S78b proof second late question', 'submitted', false, now() - interval '31 hours', now() - interval '31 hours');
  set local session_replication_role = origin;
  v_sw := private.sweep_response_time_breaches();
  perform pg_temp.rec('a second late item for the same patient inside the cooldown adds a breach but no second notice', '1,3',
    (v_sw ->> 'new') || ',' || (select count(*)::text from public.notifications where template = 'response_slower_notice'));

  -- 5. Reads ---------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  v_counts := public.response_time_breach_summary(30);
  perform pg_temp.rec('the lead sees counts by kind', '2,1,1', (v_counts -> 'by_kind' ->> 'written_question') || ',' || (v_counts -> 'by_kind' ->> 'amber_review') || ',' || (v_counts -> 'by_kind' ->> 'appointment_start'));
  perform pg_temp.rec('the lead reads breach rows', '4', (select count(*)::text from public.response_time_breaches));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('admin may read the summary', 'ok', pg_temp.try('select public.response_time_breach_summary(30)'));
  perform pg_temp.back();
  perform pg_temp.act(v_pt_late);
  perform pg_temp.rec('a patient is refused the summary', '42501', pg_temp.try('select public.response_time_breach_summary(30)'));
  perform pg_temp.rec('a patient reads no breach row', '0', (select count(*)::text from public.response_time_breaches));
  perform pg_temp.rec('a patient cannot write a breach row', '42501', pg_temp.try(format('insert into public.response_time_breaches (organisation_id, kind, subject_id, target_minutes, config_version) values (%L, ''written_question'', gen_random_uuid(), 1, 1)', v_org)));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('an ordinary clinician is refused', '42501', pg_temp.try('select public.response_time_breach_summary(30)'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon is refused', '42501', pg_temp.try('select public.response_time_breach_summary(30)'));
  perform pg_temp.back();

  -- 6. SABOTAGE: a sweep that ignores the active flag flags everything while no config is active --------------------------------------------
  delete from public.response_time_breaches;
  update public.response_time_config set is_active = false where version = 1;
  create or replace function private.sweep_response_time_breaches() returns jsonb language plpgsql security definer set search_path = '' as $f$
  begin
    insert into public.response_time_breaches (organisation_id, kind, subject_id, patient_id, target_minutes, config_version)
      select c.organisation_id, 'written_question', c.id, c.patient_id, 1, 1 from public.async_consults c where not c.is_test and c.status = 'submitted'
      on conflict do nothing;
    return jsonb_build_object('active', true);
  end $f$;
  perform private.sweep_response_time_breaches();
  insert into results values ('sabotaged', 'with no active config nothing is flagged', '0', (select count(*)::text from public.response_time_breaches));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S78b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage step did not change the matching check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
