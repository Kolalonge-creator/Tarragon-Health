-- Tarragon Health: fixes from the first real nightly screening run (migration 20261030100000).
--
-- Proves:
--   1. REMINDERS, in-app patient: a due reminder is queued ONCE as an in-app row (it was queued twice: the channel row and an
--      explicit in-app row both resolved to in_app);
--   2. REMINDERS, email patient: still gets the email row AND the in-app copy (the fix removes only the duplicate);
--   3. SCHEDULER full run: a real patient is scheduled, a test patient is not;
--   4. SCHEDULER per-patient run: a test patient CAN still be exercised with p_patient (the deliberate test path is kept);
--   5. REQUEST AUTOMATION full run: a real patient's due schedule is issued a request, a test patient's is not;
--   6. REQUEST AUTOMATION per-patient run: a test patient's request is still issued with p_patient.
--
-- Sabotage (inside this script, rolled back): each patch is reverted in turn from the live function body. The matching checks must then
-- show the old behaviour (two in-app rows; a test patient scheduled and issued a request by the full run). If a revert changes nothing,
-- the proof is not exercising the patch and the script raises VACUOUS.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/screening_nightly_jobs_dedupe_and_test_accounts.sql

begin;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean, p_dob date default null, p_sex text default null) returns uuid
language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'nj-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = p_org, role = p_role::public.user_role, full_name = 'NJ ' || p_label,
         is_test = p_test, is_active = true, date_of_birth = p_dob, sex = p_sex::public.sex
   where id = v;
  return v;
end $f$;

-- a due, pending schedule for a non-sensitive test that has a single-test bundle (what the automation issues)
create function pg_temp.due_schedule(p_org uuid, p_patient uuid, p_set uuid) returns uuid
language plpgsql as
$f$ declare v_type uuid; v_id uuid;
begin
  select st.id into v_type from public.screen_types st
   where st.code = 'hba1c' and st.is_active and not st.sensitive;
  if v_type is null then raise exception 'fixture: no active non-sensitive hba1c screen type'; end if;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, rule_set_id)
  values (p_org, p_patient, v_type, 'pending', current_date, p_set) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.in_app_count(p_schedule uuid) returns integer
language sql as
$f$ select count(*)::integer from public.notifications n
     where n.template = 'screening_due' and n.channel = 'in_app' and n.payload ->> 'schedule_id' = p_schedule::text $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_staff uuid; v_set uuid;
  v_real uuid; v_test uuid; v_mail uuid;
  v_s_real uuid; v_s_mail uuid; v_s_test uuid;
  v_n integer; v_def text; v_pat text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician', false);
  update public.clinical_staff set active = false where doctor_tier = 'chief_medical_officer';
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo, 'NJ cmo', 'MDCN', 'NJ-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_admin,
          'chief_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, v_admin, false)
  returning id into v_staff;
  update public.screening_rule_sets set approved_by = v_staff, approved_at = now(), is_active = true where version = 1;
  select id into v_set from public.screening_rule_sets where version = 1;
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key in ('screening_scheduler_enabled', 'screening_request_automation_enabled')$b$;
  -- one patient is on the email channel, everyone else resolves to the in-app inbox
  v_mail := pg_temp.mkuser(v_org, 'mail', 'patient', false, date '1980-01-01', 'female');
  execute format($e$create or replace function private.patient_reminder_channel(p_recipient uuid, p_allow_email boolean default true) returns public.notification_channel
    language sql stable security definer set search_path = ''
    as $b$select case when p_recipient = %L::uuid then 'email'::public.notification_channel else 'in_app'::public.notification_channel end $b$ $e$, v_mail);

  v_real := pg_temp.mkuser(v_org, 'real', 'patient', false, date '1980-01-01', 'female');
  v_test := pg_temp.mkuser(v_org, 'test', 'patient', true, date '1980-01-01', 'female');

  -- 1 and 2: reminders
  v_s_real := pg_temp.due_schedule(v_org, v_real, v_set);
  v_s_mail := pg_temp.due_schedule(v_org, v_mail, v_set);
  perform private.queue_screening_reminders();
  if pg_temp.in_app_count(v_s_real) <> 1 then
    raise exception 'FAIL 1: an in-app patient got % in-app rows for one due reminder, expected 1', pg_temp.in_app_count(v_s_real);
  end if;
  if pg_temp.in_app_count(v_s_mail) <> 1
     or (select count(*) from public.notifications n where n.template = 'screening_due' and n.channel = 'email' and n.payload ->> 'schedule_id' = v_s_mail::text) <> 1 then
    raise exception 'FAIL 2: an email patient should get one email row and one in-app row';
  end if;

  -- 3 and 4: scheduler (use fresh patients so nothing has been scheduled yet)
  v_n := (private.run_screening_scheduler(null) ->> 'created')::integer;
  if not exists (select 1 from public.screening_schedules where patient_id = v_real and id <> v_s_real) then
    -- the real patient already had one manual schedule; any additional row proves the full run scheduled a real patient
    raise exception 'FAIL 3: the full nightly run scheduled no real patient (the proof is vacuous)';
  end if;
  if exists (select 1 from public.screening_schedules where patient_id = v_test) then
    raise exception 'FAIL 3: the full nightly run scheduled a TEST patient';
  end if;
  perform private.run_screening_scheduler(v_test);
  if not exists (select 1 from public.screening_schedules where patient_id = v_test) then
    raise exception 'FAIL 4: a per-patient run no longer schedules a test patient';
  end if;

  -- 5 and 6: request automation
  v_s_test := (select id from public.screening_schedules where patient_id = v_test order by id limit 1);
  update public.screening_schedules set due_date = current_date where id = v_s_test;
  perform private.run_screening_request_automation(null);
  if exists (select 1 from public.lab_orders where patient_id = v_test) then
    raise exception 'FAIL 5: the full automation run issued a request to a TEST patient';
  end if;
  if not exists (select 1 from public.lab_orders where patient_id = v_real and fulfilment = 'self_arranged') then
    raise exception 'FAIL 5: the full automation run issued no request to a real patient (the proof is vacuous)';
  end if;
  update public.screening_schedules set status = 'pending', due_date = current_date where patient_id = v_test and screen_type_id = (select screen_type_id from public.screening_schedules where id = v_s_test);
  perform private.run_screening_request_automation(v_test);
  if not exists (select 1 from public.lab_orders where patient_id = v_test) then
    raise exception 'FAIL 6: a per-patient automation run no longer issues a request to a test patient';
  end if;

  -- SABOTAGE 1: revert the reminder patch; an in-app patient must then get two rows
  v_def := pg_get_functiondef('private.queue_screening_reminders()'::regprocedure);
  v_pat := E'    where private.patient_reminder_channel(patient_id) <> ''in_app''\n';
  if position(v_pat in v_def) = 0 then raise exception 'VACUOUS: the reminder patch text is not in the live function'; end if;
  execute replace(v_def, v_pat, '');
  declare v_r2 uuid := pg_temp.mkuser(v_org, 'real2', 'patient', false, date '1981-01-01', 'male'); v_s2 uuid;
  begin
    v_s2 := pg_temp.due_schedule(v_org, v_r2, v_set);
    perform private.queue_screening_reminders();
    if pg_temp.in_app_count(v_s2) <> 2 then
      raise exception 'VACUOUS: with the reminder patch reverted the in-app patient got % rows, expected 2', pg_temp.in_app_count(v_s2);
    end if;
  end;

  -- SABOTAGE 2: revert the scheduler patch; the full run must then schedule a test patient
  v_def := pg_get_functiondef('private.run_screening_scheduler(uuid)'::regprocedure);
  v_pat := E'         and (p_patient is not null or not coalesce(p.is_test, false))\n';
  if position(v_pat in v_def) = 0 then raise exception 'VACUOUS: the scheduler patch text is not in the live function'; end if;
  execute replace(v_def, v_pat, '');
  declare v_t2 uuid := pg_temp.mkuser(v_org, 'test2', 'patient', true, date '1982-01-01', 'female');
  begin
    perform private.run_screening_scheduler(null);
    if not exists (select 1 from public.screening_schedules where patient_id = v_t2) then
      raise exception 'VACUOUS: with the scheduler patch reverted the full run still skipped a test patient';
    end if;
  end;

  -- SABOTAGE 3: revert the automation patch; the full run must then issue a request to a test patient
  v_def := pg_get_functiondef('private.run_screening_request_automation(uuid)'::regprocedure);
  v_pat := E'       and (p_patient is not null or not coalesce(p.is_test, false))\n';
  if position(v_pat in v_def) = 0 then raise exception 'VACUOUS: the automation patch text is not in the live function'; end if;
  execute replace(v_def, v_pat, '');
  declare v_t3 uuid := pg_temp.mkuser(v_org, 'test3', 'patient', true, date '1983-01-01', 'male'); v_s3 uuid;
  begin
    v_s3 := pg_temp.due_schedule(v_org, v_t3, v_set);
    perform private.run_screening_request_automation(null);
    if not exists (select 1 from public.lab_orders where patient_id = v_t3) then
      raise exception 'VACUOUS: with the automation patch reverted the full run still skipped a test patient';
    end if;
  end;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
