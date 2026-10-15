-- Tarragon Health
-- Proof for 20261013185145_amend_medication_carries_schedule_spec.sql.
-- public.amend_medication used to insert the new version without schedule_spec, so amending an
-- as-needed / every-N-days / weekday / taper medicine silently made it a plain daily list.
--
-- Cases:
--   1. as_needed (maxPerDay, foodNote) amended      -> new row keeps the identical spec
--   2. every_n_days amended, no new times            -> spec carried unchanged (interval, anchor, window)
--   3. every_n_days amended WITH new times           -> spec.times AND schedule_times both the new list,
--                                                        interval/anchor kept
--   4. taper amended with new plain times            -> refused (22023), nothing superseded
--   5. taper amended without times                   -> spec carried unchanged
--   6. no spec amended                               -> schedule_spec stays null
--   7. weekdays amended with new times               -> spec.times replaced, days kept
--   8. new times overlapping the spec's window       -> refused with the clear message, nothing superseded
--   (inside case 1) the superseded row keeps its own spec untouched
--   9. taper amended with a new dose                  -> refused, nothing superseded
--  10. every_n_days with endDate, duration changed    -> endDate moves to today + new duration - 1
--  11. taper amended with a new duration              -> refused, nothing superseded
--  12. as_needed amended with plain times             -> refused, nothing superseded
--
-- SABOTAGE: take the schedule_spec column out of amend_medication's insert (the pre-fix body);
-- cases 1, 2, 3, 5, 7 and 10 must FAIL (the new row's spec is null) and case 4 must FAIL (no refusal).
-- Done 2026-10-13 by running this file, unchanged, against the live pre-fix definition: it aborted
-- at case 4's consequence (the taper was superseded without a refusal, so case 5 hit 'already been
-- amended'), i.e. it fails loudly rather than passing.
--
-- Nothing persists: the whole file runs inside begin/rollback.

begin;

create temporary table test_result (case_num int, label text, outcome text, detail text) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_pat uuid;
  v_clin uuid;
  v_med uuid;
  v_new uuid;
  v_raised text;
  v_spec jsonb;
  v_times jsonb := '["08:00","20:00"]'::jsonb;

  v_asneeded jsonb := '{"kind":"as_needed","maxPerDay":3,"foodNote":"with_food"}'::jsonb;
  v_everyn   jsonb := '{"kind":"every_n_days","intervalDays":3,"anchorDate":"2026-10-01","times":["09:00"],"windowMinutes":60}'::jsonb;
  v_weekdays jsonb := '{"kind":"weekdays","days":[1,3,5],"times":["08:00"]}'::jsonb;
  v_windowed jsonb := '{"kind":"daily","times":["08:00"],"windowMinutes":120}'::jsonb;
  v_taper    jsonb := '{"kind":"taper","startDate":"2026-10-01","steps":[{"days":5,"times":["08:00"],"doseText":"20 mg"},{"days":5,"times":["08:00"],"doseText":"10 mg"}]}'::jsonb;
begin
  v_pat := gen_random_uuid();
  v_clin := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'amendspec-pat-' || v_pat || '@example.invalid', 'x', now(), '{}', '{}'),
         (v_clin, 'amendspec-doc-' || v_clin || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v_pat, v_org, 'patient', 'Amend Spec Patient', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true),
         (v_clin, v_org, 'clinician', 'Amend Spec Doctor', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_clin, 'Amend Spec Probe', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_clin, now())
  on conflict (patient_id) do update set clinician_id = v_clin;

  ---------------------------------------------------------------- case 1
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec)
  values (v_org, v_pat, 'Spec Probe PRN', '500mg', 'as needed', 'clinician', true, '30 tablets', 30, v_asneeded)
  returning id into v_med;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.amend_medication(v_med, 'Dose change', p_allergies_confirmed => true, p_dose => '1g') into v_new;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select schedule_spec into v_spec from public.medications where id = v_new;
  insert into test_result values (1, 'as_needed spec carried onto the amended row; the superseded row keeps its own',
    case when v_spec = v_asneeded
          and (select schedule_spec from public.medications where id = v_med) = v_asneeded then 'PASS' else 'FAIL' end, coalesce(v_spec::text, 'null'));

  ---------------------------------------------------------------- case 2
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec, schedule_times)
  values (v_org, v_pat, 'Spec Probe EveryN', '5mg', 'every 3 days', 'clinician', true, '10 tablets', 30, v_everyn, '["09:00"]')
  returning id into v_med;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.amend_medication(v_med, 'Dose change', p_allergies_confirmed => true, p_dose => '10mg') into v_new;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select schedule_spec into v_spec from public.medications where id = v_new;
  insert into test_result values (2, 'every_n_days spec carried unchanged when no new times',
    case when v_spec = v_everyn then 'PASS' else 'FAIL' end, coalesce(v_spec::text, 'null'));

  ---------------------------------------------------------------- case 3
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec, schedule_times)
  values (v_org, v_pat, 'Spec Probe EveryN2', '5mg', 'every 3 days', 'clinician', true, '10 tablets', 30, v_everyn, '["09:00"]')
  returning id into v_med;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.amend_medication(v_med, 'Move the times', p_allergies_confirmed => true, p_schedule_times => v_times) into v_new;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select schedule_spec into v_spec from public.medications where id = v_new;
  insert into test_result values (3, 'explicit new times replace spec.times and schedule_times, rest of the spec kept',
    case when v_spec = jsonb_set(v_everyn, '{times}', v_times)
          and (select schedule_times from public.medications where id = v_new) = v_times
         then 'PASS' else 'FAIL' end, coalesce(v_spec::text, 'null'));

  ---------------------------------------------------------------- case 4
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec)
  values (v_org, v_pat, 'Spec Probe Taper', '20mg', 'taper', 'clinician', true, '20 tablets', 10, v_taper)
  returning id into v_med;
  v_raised := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_med, 'Try plain times on a taper', p_allergies_confirmed => true, p_schedule_times => v_times);
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'taper amended with plain times is refused and nothing is superseded',
    case when v_raised like '%tapering schedule%'
          and (select superseded_at from public.medications where id = v_med) is null
         then 'PASS' else 'FAIL' end, coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 5
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.amend_medication(v_med, 'Dose note change', p_allergies_confirmed => true, p_instructions => 'Take with water') into v_new;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select schedule_spec into v_spec from public.medications where id = v_new;
  insert into test_result values (5, 'taper spec carried unchanged when times are not touched',
    case when v_spec = v_taper then 'PASS' else 'FAIL' end, coalesce(v_spec::text, 'null'));

  ---------------------------------------------------------------- case 6
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_times)
  values (v_org, v_pat, 'Spec Probe Plain', '5mg', 'daily', 'clinician', true, '30 tablets', 30, '["08:00"]')
  returning id into v_med;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.amend_medication(v_med, 'Dose change', p_allergies_confirmed => true, p_dose => '10mg') into v_new;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'plain daily medicine still has no spec and keeps its times',
    case when (select schedule_spec from public.medications where id = v_new) is null
          and (select schedule_times from public.medications where id = v_new) = '["08:00"]'::jsonb
         then 'PASS' else 'FAIL' end, '');

  ---------------------------------------------------------------- case 7
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec, schedule_times)
  values (v_org, v_pat, 'Spec Probe Weekdays', '5mg', 'Mon Wed Fri', 'clinician', true, '12 tablets', 30, v_weekdays, '["08:00"]')
  returning id into v_med;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.amend_medication(v_med, 'Move the times', p_allergies_confirmed => true, p_schedule_times => v_times) into v_new;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select schedule_spec into v_spec from public.medications where id = v_new;
  insert into test_result values (7, 'weekdays: new times replace spec.times, days kept',
    case when v_spec = jsonb_set(v_weekdays, '{times}', v_times) then 'PASS' else 'FAIL' end, coalesce(v_spec::text, 'null'));

  ---------------------------------------------------------------- case 8
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec, schedule_times)
  values (v_org, v_pat, 'Spec Probe Window', '5mg', 'daily', 'clinician', true, '30 tablets', 30, v_windowed, '["08:00"]')
  returning id into v_med;
  v_raised := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_med, 'Times too close for the window', p_allergies_confirmed => true, p_schedule_times => '["08:00","09:00"]'::jsonb);
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (8, 'times overlapping the window are refused with the clear message, nothing superseded',
    case when v_raised like '%do not fit the existing schedule%'
          and (select superseded_at from public.medications where id = v_med) is null
         then 'PASS' else 'FAIL' end, coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 9
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec)
  values (v_org, v_pat, 'Spec Probe TaperDose', '20mg', 'x', 'clinician', true, '20 tablets', 10, v_taper)
  returning id into v_med;
  v_raised := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_med, 'Refusal probe', p_allergies_confirmed => true, p_dose => '5mg');
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (9, 'taper amended with a new dose is refused, nothing superseded',
    case when v_raised like '%sets the dose per step%' and (select superseded_at from public.medications where id = v_med) is null
         then 'PASS' else 'FAIL' end, coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 10
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec, schedule_times)
  values (v_org, v_pat, 'Spec Probe EndDate', '5mg', 'every 3 days', 'clinician', true, '10 tablets', 30,
          v_everyn || '{"endDate":"2026-10-31"}'::jsonb, '["09:00"]')
  returning id into v_med;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.amend_medication(v_med, 'Longer supply', p_allergies_confirmed => true, p_duration_days => 60) into v_new;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select schedule_spec into v_spec from public.medications where id = v_new;
  insert into test_result values (10, 'a changed duration moves a dated endDate with it',
    case when v_spec ->> 'endDate' = to_char(current_date + 59, 'YYYY-MM-DD')
          and v_spec - 'endDate' = v_everyn then 'PASS' else 'FAIL' end, coalesce(v_spec::text, 'null'));

  ---------------------------------------------------------------- case 11
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec)
  values (v_org, v_pat, 'Spec Probe TaperDur', '20mg', 'x', 'clinician', true, '20 tablets', 10, v_taper)
  returning id into v_med;
  v_raised := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_med, 'Refusal probe', p_allergies_confirmed => true, p_duration_days => 40);
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (11, 'taper amended with a new duration is refused, nothing superseded',
    case when v_raised like '%sets its length from its steps%' and (select superseded_at from public.medications where id = v_med) is null
         then 'PASS' else 'FAIL' end, coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 12
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, quantity, duration_days, schedule_spec)
  values (v_org, v_pat, 'Spec Probe PrnTimes', '20mg', 'x', 'clinician', true, '20 tablets', 10, v_asneeded)
  returning id into v_med;
  v_raised := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_med, 'Refusal probe', p_allergies_confirmed => true, p_schedule_times => v_times);
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (12, 'as_needed amended with plain times is refused, nothing superseded',
    case when v_raised like '%no fixed times%' and (select superseded_at from public.medications where id = v_med) is null
         then 'PASS' else 'FAIL' end, coalesce(v_raised, 'no error raised'));

  if exists (select 1 from test_result where outcome = 'FAIL') then
    raise exception 'amend_medication_carries_schedule_spec: %',
      (select string_agg(case_num || ' ' || label || ' ' || detail, '; ') from test_result where outcome = 'FAIL');
  end if;
end $$;

select 'CASE ' || case_num || ' [' || outcome || '] ' || label || case when detail = '' then '' else ' -- ' || detail end as line
from test_result order by case_num;

rollback;
