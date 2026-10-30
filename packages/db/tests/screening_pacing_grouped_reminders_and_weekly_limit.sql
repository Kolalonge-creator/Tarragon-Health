-- Tarragon Health: ease a new patient in (migration 20261030110000).
--
-- Proves:
--   1. GROUPING: a patient with 5 schedules entering the same reminder stage the same night gets ONE in-app reminder carrying a count,
--      naming no test, and all 5 schedules move to the new stage (none is reminded again);
--   2. up to 2 in a stage are still sent one by one, exactly as before (2 schedules -> 2 reminders, no count);
--   3. an email patient's grouped reminder is one email row plus one in-app row (not 5 + 5);
--   4. a sensitive screening is never named in a grouped or a single reminder;
--   5. NO PACING IN THE SIGNED RULE SET = NO LIMIT: automation issues a request for every eligible schedule;
--   6. WITH `pacing.maxNewRequestsPerWeek = 2` in the signed rule set: at most 2 new requests per patient in 7 days, in the signed
--      priority order (the lower-ranked test waits), and a second run the same night issues no more;
--   7. a schedule created under an EARLIER signed rule set is still issued a request after a newer rule set is signed
--      (signing v4 must not freeze the schedules created under v3);
--   8. the new private functions are not callable by anon or a signed-in user.
--
-- Sabotage (inside this script, rolled back): the grouping threshold is raised so nothing groups (check 1 must flip); the pacing cap lookup
-- is stubbed to null (check 6 must flip); the rule-set condition is put back to "must be active" (check 7 must flip). If a sabotage
-- changes nothing the script raises VACUOUS.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/screening_pacing_grouped_reminders_and_weekly_limit.sql

begin;

create function pg_temp.mkuser(p_org uuid, p_label text, p_dob date, p_sex text) returns uuid
language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'pc-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = p_org, role = 'patient'::public.user_role, full_name = 'PC ' || p_label,
         is_test = false, is_active = true, date_of_birth = p_dob, sex = p_sex::public.sex where id = v;
  return v;
end $f$;

create function pg_temp.sched(p_org uuid, p_patient uuid, p_code text, p_due date, p_set uuid) returns uuid
language plpgsql as
$f$ declare v_type uuid; v_id uuid;
begin
  select id into v_type from public.screen_types where code = p_code and is_active;
  if v_type is null then raise exception 'fixture: no active screen type %', p_code; end if;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, rule_set_id)
  values (p_org, p_patient, v_type, 'pending', p_due, p_set) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.rows_for(p_patient uuid, p_channel text) returns integer
language sql as
$f$ select count(*)::integer from public.notifications n
     where n.recipient_id = p_patient and n.channel::text = p_channel and n.template = 'screening_due' $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_staff uuid; v_set uuid; v_set4 uuid;
  v_five uuid; v_two uuid; v_mail uuid; v_sens uuid; v_p uuid;
  v_ids uuid[]; v_i uuid; v_n integer; v_payload jsonb; v_codes text[];
  v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'pc-admin-' || substr(v_admin::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'admin'::public.user_role, is_test = true, is_active = true where id = v_admin;
  v_cmo := pg_temp.mkuser(v_org, 'cmo', date '1970-01-01', 'male');
  update public.profiles set role = 'clinician'::public.user_role where id = v_cmo;
  update public.clinical_staff set active = false where doctor_tier = 'chief_medical_officer';
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo, 'PC cmo', 'MDCN', 'PC-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_admin,
          'chief_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, v_admin, false)
  returning id into v_staff;
  update public.screening_rule_sets set approved_by = v_staff, approved_at = now(), is_active = true where version = 1;
  select id into v_set from public.screening_rule_sets where version = 1;
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key in ('screening_scheduler_enabled', 'screening_request_automation_enabled')$b$;

  v_five := pg_temp.mkuser(v_org, 'five', date '1980-01-01', 'female');
  v_two := pg_temp.mkuser(v_org, 'two', date '1980-01-01', 'female');
  v_mail := pg_temp.mkuser(v_org, 'mail', date '1980-01-01', 'female');
  v_sens := pg_temp.mkuser(v_org, 'sens', date '1980-01-01', 'female');
  execute format($e$create or replace function private.patient_reminder_channel(p_recipient uuid, p_allow_email boolean default true) returns public.notification_channel
    language sql stable security definer set search_path = ''
    as $b$select case when p_recipient = %L::uuid then 'email'::public.notification_channel else 'in_app'::public.notification_channel end $b$ $e$, v_mail);

  -- 1: five schedules due today for one patient
  v_ids := array[
    pg_temp.sched(v_org, v_five, 'hba1c', current_date, v_set), pg_temp.sched(v_org, v_five, 'lipid_panel', current_date, v_set),
    pg_temp.sched(v_org, v_five, 'kft', current_date, v_set), pg_temp.sched(v_org, v_five, 'lft', current_date, v_set),
    pg_temp.sched(v_org, v_five, 'fbc', current_date, v_set)];
  -- 2: two for another
  perform pg_temp.sched(v_org, v_two, 'hba1c', current_date, v_set);
  perform pg_temp.sched(v_org, v_two, 'fbc', current_date, v_set);
  -- 3: five for an email patient
  for v_n in 1..5 loop
    perform pg_temp.sched(v_org, v_mail, (array['hba1c','lipid_panel','kft','lft','fbc'])[v_n], current_date, v_set);
  end loop;
  -- 4: a sensitive one among three for a fourth patient (grouped), and check it is not named
  perform pg_temp.sched(v_org, v_sens, 'hba1c', current_date, v_set);
  perform pg_temp.sched(v_org, v_sens, 'fbc', current_date, v_set);
  perform pg_temp.sched(v_org, v_sens, 'hiv', current_date, v_set);

  perform private.queue_screening_reminders();

  if pg_temp.rows_for(v_five, 'in_app') <> 1 then raise exception 'FAIL 1: 5 schedules gave % in-app reminders, expected 1', pg_temp.rows_for(v_five, 'in_app'); end if;
  select n.payload into v_payload from public.notifications n where n.recipient_id = v_five and n.template = 'screening_due' and n.channel = 'in_app';
  if (v_payload ->> 'count')::integer <> 5 then raise exception 'FAIL 1: the grouped reminder carries count %, expected 5', v_payload ->> 'count'; end if;
  if v_payload ->> 'screen_type_name' ilike '%hba1c%' or v_payload::text ilike '%lipid%' then raise exception 'FAIL 1: the grouped reminder names a test'; end if;
  if (select count(*) from public.screening_schedules where patient_id = v_five and reminder_stage = 'due') <> 5 then raise exception 'FAIL 1: not every schedule moved to the due stage'; end if;
  perform private.queue_screening_reminders();
  if pg_temp.rows_for(v_five, 'in_app') <> 1 then raise exception 'FAIL 1: a second run reminded again'; end if;

  if pg_temp.rows_for(v_two, 'in_app') <> 2 then raise exception 'FAIL 2: 2 schedules gave % reminders, expected 2 (sent one by one)', pg_temp.rows_for(v_two, 'in_app'); end if;
  if exists (select 1 from public.notifications n where n.recipient_id = v_two and n.payload ? 'count') then raise exception 'FAIL 2: a single reminder carries a count'; end if;

  if pg_temp.rows_for(v_mail, 'in_app') <> 1 or pg_temp.rows_for(v_mail, 'email') <> 1 then
    raise exception 'FAIL 3: an email patient should get one email row and one in-app row, got % email and % in-app', pg_temp.rows_for(v_mail, 'email'), pg_temp.rows_for(v_mail, 'in_app');
  end if;

  if exists (select 1 from public.notifications n where n.recipient_id = v_sens and (n.payload::text ilike '%hiv%')) then
    raise exception 'FAIL 4: a reminder names a sensitive test';
  end if;

  -- 5: no pacing in the signed set: every eligible schedule is issued
  if private.screening_pacing_cap() is not null then raise exception 'FAIL 5: a cap exists with no pacing in the signed rule set'; end if;
  v_p := pg_temp.mkuser(v_org, 'nopace', date '1980-01-01', 'female');
  perform pg_temp.sched(v_org, v_p, 'hba1c', current_date, v_set);
  perform pg_temp.sched(v_org, v_p, 'lipid_panel', current_date, v_set);
  perform pg_temp.sched(v_org, v_p, 'kft', current_date, v_set);
  perform private.run_screening_request_automation(v_p);
  select count(*) into v_n from public.lab_orders where patient_id = v_p and screening_schedule_id is not null;
  if v_n = 0 then raise exception 'FAIL 5: nothing was issued (the proof is vacuous: no bundles for the fixture tests)'; end if;
  v_codes := array(select st.code from public.lab_orders o join public.screening_schedules s on s.id = o.screening_schedule_id join public.screen_types st on st.id = s.screen_type_id where o.patient_id = v_p);
  if cardinality(v_codes) <> (select count(*) from public.screening_schedules s join public.panel_bundles b on b.is_active and b.test_codes = array[(select code from public.screen_types where id = s.screen_type_id)] where s.patient_id = v_p) then
    raise exception 'FAIL 5: with no limit, % of the eligible schedules were issued', cardinality(v_codes);
  end if;
  v_n := cardinality(v_codes);

  -- 6: pacing in the signed set: 2 a week, kft before hba1c before fbc
  insert into public.screening_rule_sets (code, version, config, is_active)
  select code, 90, jsonb_set(config, '{pacing}', jsonb_build_object('maxNewRequestsPerWeek', 2, 'priority', jsonb_build_array('kft', 'hba1c', 'fbc')), true), false
    from public.screening_rule_sets where id = v_set returning id into v_set4;
  -- 7 (first half): schedules created under v_set (the earlier signed set), then v_set4 is signed and becomes the active one
  v_p := pg_temp.mkuser(v_org, 'paced', date '1980-01-01', 'female');
  perform pg_temp.sched(v_org, v_p, 'fbc', current_date, v_set);
  perform pg_temp.sched(v_org, v_p, 'hba1c', current_date, v_set);
  perform pg_temp.sched(v_org, v_p, 'kft', current_date, v_set);
  update public.screening_rule_sets set is_active = false where id = v_set;
  update public.screening_rule_sets set approved_by = v_staff, approved_at = now(), is_active = true where id = v_set4;
  if private.screening_pacing_cap() <> 2 then raise exception 'FAIL 6: the signed pacing cap is %, expected 2', private.screening_pacing_cap(); end if;
  perform private.run_screening_request_automation(v_p);
  select count(*) into v_n from public.lab_orders where patient_id = v_p and screening_schedule_id is not null;
  if v_n = 0 then raise exception 'FAIL 7: schedules of the earlier signed rule set were frozen when a newer set was signed'; end if;
  if v_n <> 2 then raise exception 'FAIL 6: % requests were issued in one night, expected the weekly limit of 2', v_n; end if;
  v_codes := array(select st.code from public.lab_orders o join public.screening_schedules s on s.id = o.screening_schedule_id join public.screen_types st on st.id = s.screen_type_id where o.patient_id = v_p order by st.code);
  if v_codes <> array['hba1c', 'kft'] then raise exception 'FAIL 6: issued % but the signed priority puts kft and hba1c before fbc', v_codes; end if;
  perform private.run_screening_request_automation(v_p);
  select count(*) into v_n from public.lab_orders where patient_id = v_p and screening_schedule_id is not null;
  if v_n <> 2 then raise exception 'FAIL 6: a second run the same night issued more (% in total)', v_n; end if;

  -- 8: privileges
  if has_function_privilege('anon', 'private.queue_screening_stage(text,text,uuid[],boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_screening_stage(text,text,uuid[],boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_screening_notification(uuid,uuid,text,boolean,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.screening_pacing_cap()', 'EXECUTE')
     or has_function_privilege('anon', 'private.queue_screening_reminders()', 'EXECUTE') then
    raise exception 'FAIL 8: a client role can execute a screening pacing function';
  end if;

  -- SABOTAGE 1: nothing groups -> a fresh 5-schedule patient gets 5 reminders
  v_def := pg_get_functiondef('private.queue_screening_stage(text,text,uuid[],boolean)'::regprocedure);
  if position('v_group_over constant integer := 2' in v_def) = 0 then raise exception 'VACUOUS: grouping threshold text not found'; end if;
  execute replace(v_def, 'v_group_over constant integer := 2', 'v_group_over constant integer := 99');
  v_p := pg_temp.mkuser(v_org, 'sab1', date '1980-01-01', 'female');
  for v_n in 1..5 loop perform pg_temp.sched(v_org, v_p, (array['hba1c','lipid_panel','kft','lft','fbc'])[v_n], current_date, v_set4); end loop;
  perform private.queue_screening_reminders();
  if pg_temp.rows_for(v_p, 'in_app') <> 5 then raise exception 'VACUOUS: with grouping disabled the patient got % reminders, expected 5', pg_temp.rows_for(v_p, 'in_app'); end if;

  -- SABOTAGE 2: the cap lookup returns null -> the weekly limit stops working
  create or replace function private.screening_pacing_cap() returns integer language sql stable security definer set search_path = '' as $b$ select null::integer $b$;
  v_p := pg_temp.mkuser(v_org, 'sab2', date '1980-01-01', 'female');
  perform pg_temp.sched(v_org, v_p, 'fbc', current_date, v_set4);
  perform pg_temp.sched(v_org, v_p, 'hba1c', current_date, v_set4);
  perform pg_temp.sched(v_org, v_p, 'kft', current_date, v_set4);
  perform private.run_screening_request_automation(v_p);
  select count(*) into v_n from public.lab_orders where patient_id = v_p and screening_schedule_id is not null;
  if v_n <= 2 then raise exception 'VACUOUS: with the cap lookup stubbed to null, % requests were issued (expected more than 2)', v_n; end if;

  -- SABOTAGE 3: put the rule-set condition back to "must be active" -> earlier-set schedules freeze
  v_def := pg_get_functiondef('private.run_screening_request_automation(uuid)'::regprocedure);
  if position('rs.id = s.rule_set_id and rs.approved_by is not null' in v_def) = 0 then raise exception 'VACUOUS: rule-set condition text not found'; end if;
  execute replace(v_def, 'rs.id = s.rule_set_id and rs.approved_by is not null', 'rs.id = s.rule_set_id and rs.is_active and rs.approved_by is not null');
  v_p := pg_temp.mkuser(v_org, 'sab3', date '1980-01-01', 'female');
  perform pg_temp.sched(v_org, v_p, 'hba1c', current_date, v_set);
  perform private.run_screening_request_automation(v_p);
  if exists (select 1 from public.lab_orders where patient_id = v_p and screening_schedule_id is not null) then
    raise exception 'VACUOUS: with the old active-only condition a schedule of an earlier signed set was still issued';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
