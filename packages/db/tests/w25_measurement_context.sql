-- ===========================================================================
-- Proof: 20261027192319_w25_measurement_context_target_config_stratified_view.sql and 20261027200107_w25b_validate_measurement_context_constraints.sql
-- (W-25, founder decision D-09).
-- NOT EXECUTED when written (the local Postgres / Docker was down). First real run is the CI "Supabase migration replay" job; read the first failure as a fixture problem
-- before a product problem.
--
-- PROVES
--   1. The grade table (packages/clinical/src/reading-grade-cases.json, embedded below; a Jest test fails if the two differ) gives the same answers in SQL as in TypeScript,
--      and with no configuration the grade is null (nothing hard-coded).
--   2. measurement_context is BP-only, cannot contradict entry_origin, is frozen after insert, and both checks are validated by the follow-up migration.
--   3. The target config ships unsigned and inactive; the signed accessor is null; an active unsigned row is refused; a user role has no direct access to the table.
--   4. private.v_bp_readings_all: a wearable estimate never appears; a clinic reading appears as context 'clinic' and ungraded; a home reading as home_self with grade rest_not_recorded.
--   5. private.bp_outcome_stratified with the config UNSIGNED withholds control. The function stays UNGRANTED (overlapping strata are not yet protected against differencing).
--   6. SIGNED (signed inside this rolled-back transaction by a staff row minted here; no signer exists): a cohort sized from min_cell_floor() is uncontrolled on the home line
--      and the same people controlled on the clinic line (never blended).
--   7. A signed row cannot be changed (trigger); SABOTAGE: with the trigger dropped the change succeeds, so the check discriminates.
--   8. SABOTAGE: an accessor that ignores the signature makes the unsigned config look signed (so check 5a would have failed).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

create temp table w25_results (check_name text, observed text, expected text, verdict text);
grant all on w25_results to public;
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin
  insert into w25_results values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end);
end $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  p0 uuid := gen_random_uuid();
  pid uuid;
  v_clin uuid := gen_random_uuid();
  i integer; k integer;
  v_n integer := private.min_cell_floor() + 2;
  v_staff uuid;
  v_ok boolean;
  v_rid uuid;
  v_json jsonb;
  v_def text;
  v_row jsonb;
  v_cases jsonb;
  v_cfg jsonb;
  e jsonb;
begin
  v_cfg := private.bp_target_config_latest() #> '{config,grade}';

  -- 1. the grade table, one copy shared with the Jest test
  -- grade-cases-begin
  v_cases := $json$[
 {"name": "seated, rested 5, repeat", "position": "seated", "restedMinutes": 5, "repeatCount": 1, "systolic": 120, "diastolic": 80, "expected": "A"},
 {"name": "seated, rested 4, repeat", "position": "seated", "restedMinutes": 4, "repeatCount": 1, "systolic": 120, "diastolic": 80, "expected": "B"},
 {"name": "seated, rested 5, no repeat", "position": "seated", "restedMinutes": 5, "repeatCount": 0, "systolic": 120, "diastolic": 80, "expected": "B"},
 {"name": "seated, rest not recorded", "position": "seated", "restedMinutes": null, "repeatCount": 1, "systolic": 120, "diastolic": 80, "expected": "rest_not_recorded"},
 {"name": "position not recorded", "position": null, "restedMinutes": 5, "repeatCount": 1, "systolic": 120, "diastolic": 80, "expected": "unknown"},
 {"name": "standing", "position": "standing", "restedMinutes": 5, "repeatCount": 1, "systolic": 120, "diastolic": 80, "expected": "C"},
 {"name": "lying", "position": "lying", "restedMinutes": 5, "repeatCount": 1, "systolic": 120, "diastolic": 80, "expected": "C"},
 {"name": "systolic below the plausible floor", "position": "seated", "restedMinutes": 5, "repeatCount": 1, "systolic": 59, "diastolic": 40, "expected": "C"},
 {"name": "systolic not above diastolic", "position": "seated", "restedMinutes": 5, "repeatCount": 1, "systolic": 80, "diastolic": 120, "expected": "C"},
 {"name": "diastolic above the plausible ceiling", "position": "seated", "restedMinutes": 5, "repeatCount": 1, "systolic": 200, "diastolic": 161, "expected": "C"},
 {"name": "implausible and position not recorded", "position": null, "restedMinutes": 5, "repeatCount": 1, "systolic": 300, "diastolic": 80, "expected": "C"}
]$json$::jsonb;
  -- grade-cases-end
  for e in select x from jsonb_array_elements(v_cases) x loop
    perform pg_temp.chk('1 ' || (e ->> 'name'), e ->> 'expected',
      private.bp_reading_grade(e ->> 'position', (e ->> 'restedMinutes')::numeric, (e ->> 'repeatCount')::integer, (e ->> 'systolic')::integer, (e ->> 'diastolic')::integer, v_cfg));
  end loop;
  perform pg_temp.chk('1z with no configuration the grade is null', 'true', (private.bp_reading_grade('seated', 5, 1, 120, 80, null) is null)::text);

  -- a clinician fixture to sign with (the table references clinical_staff)
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_clin, 'w25c-' || replace(v_clin::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values (v_clin, v_org, 'clinician', 'W25 Signer', '+2348025099999')
  on conflict (id) do update set role = 'clinician';
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, v_clin, 'W25 Signer', true, now(), 'senior_medical_officer', 'Probe Indemnity Ltd', 'PROBE-W25', now() + interval '1 year')
  returning id into v_staff;

  -- fixture patient for the column checks (a test account passes the label guards, so only the new check can refuse the contradiction below)
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (p0, 'w25-' || replace(p0::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values (p0, v_org, 'patient', 'W25 Patient', '+2348025000000')
  on conflict (id) do update set role = 'patient';
  update public.profiles set is_test = true where id = p0;

  -- 2. the column
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, client_recorded_at, source, measurement_context)
  values (v_org, p0, 'blood_pressure', 130, 84, 'seated', 'left', now() - interval '3 days', now() - interval '3 days', 'manual', 'home_self')
  returning id into v_rid;
  perform pg_temp.chk('2a a home_self blood pressure saves', 'home_self', (select measurement_context from public.vitals_readings where id = v_rid));

  v_ok := false;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, taken_at, client_recorded_at, source, measurement_context)
    values (v_org, p0, 'glucose', 5.5, now() - interval '3 days', now() - interval '3 days', 'manual', 'home_self');
  exception when check_violation then v_ok := true; end;
  perform pg_temp.chk('2b a glucose reading cannot carry a measurement context', 'true', v_ok::text);

  v_ok := false;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, client_recorded_at, source, measurement_context, entry_origin, place_label)
    values (v_org, p0, 'blood_pressure', 130, 84, 'seated', 'left', now() - interval '2 days', now() - interval '2 days', 'manual', 'diary', 'pharmacy_machine', 'Test pharmacy');
  exception when check_violation then v_ok := true; end;
  perform pg_temp.chk('2c a context that contradicts the entry origin is refused', 'true', v_ok::text);

  v_ok := false;
  begin
    update public.vitals_readings set measurement_context = 'pharmacy' where id = v_rid;
  exception when others then v_ok := true; end;
  perform pg_temp.chk('2d the context is frozen after insert', 'true', v_ok::text);
  perform pg_temp.chk('2e it is in the frozen list', 'true',
    (select ((regexp_match(pg_get_triggerdef(g.oid), 'enforce_clinical_value_supersession\(''([^'']*)''\)'))[1] ~ '(^|,)measurement_context(,|$)')::text
       from pg_trigger g where g.tgrelid = 'public.vitals_readings'::regclass and g.tgname = 'a_clinical_value_supersession'));
  perform pg_temp.chk('2f both checks are validated (follow-up migration)', '2',
    (select count(*)::text from pg_constraint where conrelid = 'public.vitals_readings'::regclass and convalidated
        and conname in ('vitals_readings_measurement_context_check', 'vitals_readings_measurement_context_origin_check')));

  -- 3. the config ships unsigned and inactive
  perform pg_temp.chk('3a v1 unsigned and inactive', '1/0/0', (select count(*) || '/' || count(*) filter (where approved_by is not null) || '/' || count(*) filter (where is_active) from public.bp_target_config));
  perform pg_temp.chk('3b the signed accessor returns nothing', 'true', (private.bp_target_config_active() is null)::text);
  v_ok := false;
  begin
    update public.bp_target_config set is_active = true where version = 1;
  exception when check_violation then v_ok := true; end;
  perform pg_temp.chk('3c an active unsigned row is refused', 'true', v_ok::text);
  perform pg_temp.chk('3d latest says unsigned', 'false', (private.bp_target_config_latest() ->> 'signed'));
  perform pg_temp.chk('3e authenticated has no direct access to the table', 'false/false/false',
    has_table_privilege('authenticated', 'public.bp_target_config', 'SELECT')::text || '/' || has_table_privilege('authenticated', 'public.bp_target_config', 'INSERT')::text
    || '/' || has_table_privilege('authenticated', 'public.bp_target_config', 'UPDATE')::text);
  perform pg_temp.chk('3f get_bp_target_config is open to authenticated and not anon, and carries no notes', 'true/false/false',
    has_function_privilege('authenticated', 'public.get_bp_target_config()', 'EXECUTE')::text || '/' || has_function_privilege('anon', 'public.get_bp_target_config()', 'EXECUTE')::text
    || '/' || (private.bp_target_config_latest() ? 'notes')::text);

  -- 4. the read view
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
  values (v_org, p0, 'blood_pressure', 150, 95, 'seated', 'left', now() - interval '1 day', 'wearable');
  insert into public.clinic_bp_readings (organisation_id, patient_id, systolic, diastolic, measured_at, recorded_by)
  values (v_org, p0, 136, 86, now() - interval '1 day', p0);
  perform pg_temp.chk('4a the wearable estimate is not in the view', '0', (select count(*)::text from private.v_bp_readings_all where patient_id = p0 and systolic = 150));
  perform pg_temp.chk('4b the clinic reading is, as context clinic and ungraded', 'clinic/clinic/', (select origin_table || '/' || context || '/' || coalesce(reading_grade, '') from private.v_bp_readings_all where patient_id = p0 and origin_table = 'clinic'));
  perform pg_temp.chk('4c the home reading is, as home_self', 'home_self', (select context from private.v_bp_readings_all where reading_id = v_rid));
  perform pg_temp.chk('4d it is never labelled A or B on rest it does not have', 'rest_not_recorded', (select reading_grade from private.v_bp_readings_all where reading_id = v_rid));

  -- 5. UNSIGNED: no control figure anywhere
  v_json := private.bp_outcome_stratified(current_date - 30, current_date);
  perform pg_temp.chk('5a unsigned: target_signed false', 'false', (v_json ->> 'target_signed'));
  perform pg_temp.chk('5b unsigned: the reason is stated', 'target_unsigned', (v_json ->> 'control_withheld_reason'));
  perform pg_temp.chk('5c unsigned: no stratum carries a control count', '0', (select count(*)::text from jsonb_array_elements(v_json -> 'strata') s where s ? 'controlled' or s ? 'uncontrolled'));
  perform pg_temp.chk('5d the tier basis is stated', 'as_of_latest_reading_in_stratum', (v_json ->> 'tier_basis'));
  perform pg_temp.chk('5e the stratified function is not granted to any user role (differencing guard)', 'false/false/false',
    has_function_privilege('anon', 'private.bp_outcome_stratified(date, date)', 'EXECUTE')::text || '/'
    || has_function_privilege('authenticated', 'private.bp_outcome_stratified(date, date)', 'EXECUTE')::text || '/'
    || has_table_privilege('authenticated', 'private.v_bp_readings_all', 'SELECT')::text);

  -- 8. SABOTAGE: an accessor that ignores the signature; check 5a must now see "signed"
  v_def := pg_get_functiondef('private.bp_target_config_active()'::regprocedure);
  execute replace(v_def, 'where is_active and approved_by is not null', 'order by version desc limit 1');
  if private.bp_target_config_active() is null then raise exception 'sabotage setup FAIL: the replaced accessor still returns nothing'; end if;
  perform pg_temp.chk('8 sabotage: an accessor that ignores the signature makes the unsigned config look signed (so check 5a would have failed)', 'true',
    ((private.bp_outcome_stratified(current_date - 30, current_date) ->> 'target_signed') = 'true')::text);
  execute v_def;   -- restore
  perform pg_temp.chk('8 restored: back to unsigned', 'false', (private.bp_outcome_stratified(current_date - 30, current_date) ->> 'target_signed'));

  -- 6. SIGNED (rolled back): a cohort sized from the floor, home mean 138/88 (uncontrolled on 135/85), clinic readings 138/88 (controlled on 140/90)
  for i in 1..v_n loop
    pid := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (pid, 'w25-' || replace(pid::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone) values (pid, v_org, 'patient', 'W25 Cohort ' || i, '+23480250' || lpad(i::text, 5, '0'))
    on conflict (id) do update set role = 'patient';
    for k in 1..3 loop
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, client_recorded_at, source, measurement_context)
      values (v_org, pid, 'blood_pressure', 136 + k, 86 + k, 'seated', 'left', now() - make_interval(mins => 30 + k * 4), now() - make_interval(mins => 30 + k * 4), 'manual', 'home_self');
      insert into public.clinic_bp_readings (organisation_id, patient_id, systolic, diastolic, measured_at, recorded_by)
      values (v_org, pid, 136 + k, 86 + k, now() - make_interval(mins => 30 + k * 4), pid);
    end loop;
  end loop;
  -- means are 138 / 88: 138 < 140 and 88 < 90 under the clinic line; 138 >= 135 over the home line.

  update public.bp_target_config set approved_by = v_staff, approved_at = now(), is_active = true where version = 1;
  v_json := private.bp_outcome_stratified(current_date - 1, current_date);
  perform pg_temp.chk('6a signed: target_signed true', 'true', (v_json ->> 'target_signed'));
  select s into v_row from jsonb_array_elements(v_json -> 'strata') s where s ->> 'context' = 'home_self' and s ->> 'source' = 'manual' and not (s ? 'suppressed') limit 1;
  perform pg_temp.chk('6b the home stratum is judged on the HOME line: all uncontrolled', '0/' || v_n, (v_row ->> 'controlled') || '/' || (v_row ->> 'uncontrolled'));
  perform pg_temp.chk('6b2 its grade is honest about rest', 'rest_not_recorded/free', (v_row ->> 'grade') || '/' || (v_row ->> 'tier'));
  select s into v_row from jsonb_array_elements(v_json -> 'strata') s where s ->> 'context' = 'clinic' and not (s ? 'suppressed') limit 1;
  perform pg_temp.chk('6c the clinic stratum is judged on the CLINIC line: all controlled', v_n || '/0', (v_row ->> 'controlled') || '/' || (v_row ->> 'uncontrolled'));
  perform pg_temp.chk('6d the only contexts present are known ones', '0', (select count(*)::text from jsonb_array_elements(v_json -> 'strata') s where s ->> 'context' not in ('home_self', 'clinic', 'unlabelled', 'home_assisted', 'pharmacy', 'diary')));

  -- 7. a signed row cannot change
  v_ok := false;
  begin
    update public.bp_target_config set config = jsonb_set(config, '{targets,home,systolic}', '150') where version = 1;
  exception when insufficient_privilege then v_ok := true; end;
  perform pg_temp.chk('7a a signed version cannot be edited', 'true', v_ok::text);
  v_ok := false;
  begin
    delete from public.bp_target_config where version = 1;
  exception when insufficient_privilege then v_ok := true; end;
  perform pg_temp.chk('7b a signed version cannot be deleted', 'true', v_ok::text);
  -- SABOTAGE: drop the trigger; the same edit must now succeed
  drop trigger bp_target_config_immutable on public.bp_target_config;
  update public.bp_target_config set config = jsonb_set(config, '{targets,home,systolic}', '150') where version = 1;
  perform pg_temp.chk('7c sabotage: without the trigger the edit lands (so 7a discriminates)', '150', (select config #>> '{targets,home,systolic}' from public.bp_target_config where version = 1));
  update public.bp_target_config set config = jsonb_set(config, '{targets,home,systolic}', '135') where version = 1;
  create trigger bp_target_config_immutable before update or delete on public.bp_target_config
    for each row execute function private.bp_target_config_immutable();
end $$;

select * from w25_results order by check_name;
do $$ begin
  if exists (select 1 from w25_results where verdict <> 'PASS') then raise exception 'w25 proof FAILED: %', (select string_agg(check_name, '; ') from w25_results where verdict <> 'PASS'); end if;
end $$;
rollback;
