-- ===========================================================================
-- Proof: 20261027192319_w25_measurement_context_target_config_stratified_view.sql (W-25, founder decision D-09).
-- NOT EXECUTED when written (the local Postgres / Docker was down). First real run is the CI "Supabase migration replay" job; read the first failure as a fixture problem
-- before a product problem.
--
-- PROVES
--   1. Grade truth table (the same ten cases as packages/clinical/src/reading-grade.test.ts).
--   2. measurement_context is BP-only, cannot contradict entry_origin, and is frozen after insert.
--   3. The target config ships unsigned and inactive; private.bp_target_config_active() is null; an active unsigned row is refused by a check.
--   4. private.v_bp_readings_all: a wearable estimate never appears; a clinic reading appears as context 'clinic' and ungraded; a home reading as home_self.
--   5. private.bp_outcome_stratified with the config UNSIGNED: target_signed false, control_withheld_reason target_unsigned, no stratum carries a control count.
--   6. SIGNED (the row is signed inside this rolled-back transaction by direct update; no signer exists): 22 people with a home mean of 138/88 are UNcontrolled on the home
--      line and the SAME people are controlled on the clinic line (their clinic readings are 138/88 too): home and clinic are never blended.
--   7. SABOTAGE: private.bp_target_config_active() replaced by a version that ignores the signature; the unsigned-config check (5) must now fail (it reports target_signed true).
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
  i integer; k integer;
  v_staff uuid;
  v_ok boolean;
  v_rid uuid;
  v_json jsonb;
  v_def text;
  v_row jsonb;
  c record;
begin
  -- 1. grade truth table
  perform pg_temp.chk('1a seated rested repeat', 'A', private.bp_reading_grade('seated', 5, 1, 120, 80));
  perform pg_temp.chk('1b rested 4', 'B', private.bp_reading_grade('seated', 4, 1, 120, 80));
  perform pg_temp.chk('1c rest not recorded', 'B', private.bp_reading_grade('seated', null, 1, 120, 80));
  perform pg_temp.chk('1d no repeat', 'B', private.bp_reading_grade('seated', 5, 0, 120, 80));
  perform pg_temp.chk('1e standing', 'C', private.bp_reading_grade('standing', 5, 1, 120, 80));
  perform pg_temp.chk('1f lying', 'C', private.bp_reading_grade('lying', 5, 1, 120, 80));
  perform pg_temp.chk('1g position unknown', 'C', private.bp_reading_grade(null, 5, 1, 120, 80));
  perform pg_temp.chk('1h systolic below floor', 'C', private.bp_reading_grade('seated', 5, 1, 59, 40));
  perform pg_temp.chk('1i systolic not above diastolic', 'C', private.bp_reading_grade('seated', 5, 1, 80, 120));
  perform pg_temp.chk('1j diastolic above ceiling', 'C', private.bp_reading_grade('seated', 5, 1, 200, 161));

  -- fixture patient for the column checks
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (p0, 'w25-' || replace(p0::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values (p0, v_org, 'patient', 'W25 Patient', '+2348025000000')
  on conflict (id) do update set role = 'patient';

  -- 2. the column (a test account passes the label guards, so only the new check can refuse the contradiction below)
  update public.profiles set is_test = true where id = p0;
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

  -- 3. the config ships unsigned and inactive
  perform pg_temp.chk('3a v1 unsigned and inactive', '1/0/0', (select count(*) || '/' || count(*) filter (where approved_by is not null) || '/' || count(*) filter (where is_active) from public.bp_target_config));
  perform pg_temp.chk('3b the signed accessor returns nothing', 'true', (private.bp_target_config_active() is null)::text);
  v_ok := false;
  begin
    update public.bp_target_config set is_active = true where version = 1;
  exception when check_violation then v_ok := true; end;
  perform pg_temp.chk('3c an active unsigned row is refused', 'true', v_ok::text);
  perform pg_temp.chk('3d latest says unsigned', 'false', (private.bp_target_config_latest() ->> 'signed'));
  perform pg_temp.chk('3e authenticated cannot write', 'false/false', has_table_privilege('authenticated', 'public.bp_target_config', 'INSERT')::text || '/' || has_table_privilege('authenticated', 'public.bp_target_config', 'UPDATE')::text);

  -- 4. the read view: a wearable estimate never enters; a clinic reading does, ungraded
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
  values (v_org, p0, 'blood_pressure', 150, 95, 'seated', 'left', now() - interval '1 day', 'wearable');
  insert into public.clinic_bp_readings (organisation_id, patient_id, systolic, diastolic, measured_at, recorded_by)
  values (v_org, p0, 136, 86, now() - interval '1 day', p0);
  perform pg_temp.chk('4a the wearable estimate is not in the view', '0', (select count(*)::text from private.v_bp_readings_all where patient_id = p0 and systolic = 150));
  perform pg_temp.chk('4b the clinic reading is, as context clinic and ungraded', 'clinic/clinic/', (select origin_table || '/' || context || '/' || coalesce(reading_grade, '') from private.v_bp_readings_all where patient_id = p0 and origin_table = 'clinic'));
  perform pg_temp.chk('4c the home reading is, as home_self', 'home_self', (select context from private.v_bp_readings_all where reading_id = v_rid));

  -- 5. UNSIGNED: no control figure anywhere
  v_json := private.bp_outcome_stratified(current_date - 30, current_date);
  perform pg_temp.chk('5a unsigned: target_signed false', 'false', (v_json ->> 'target_signed'));
  perform pg_temp.chk('5b unsigned: the reason is stated', 'target_unsigned', (v_json ->> 'control_withheld_reason'));
  perform pg_temp.chk('5c unsigned: no stratum carries a control count', '0', (select count(*)::text from jsonb_array_elements(v_json -> 'strata') s where s ? 'controlled' or s ? 'uncontrolled'));

  -- 7 (part 1). SABOTAGE: an accessor that ignores the signature; check 5a must now see "signed" (the unsigned check discriminates)
  v_def := pg_get_functiondef('private.bp_target_config_active()'::regprocedure);
  execute replace(v_def, 'where is_active and approved_by is not null', 'order by version desc limit 1');
  if private.bp_target_config_active() is null then raise exception 'sabotage setup FAIL: the replaced accessor still returns nothing'; end if;
  perform pg_temp.chk('7 sabotage: an accessor that ignores the signature makes the unsigned config look signed (so check 5a would have failed)', 'true',
    ((private.bp_outcome_stratified(current_date - 30, current_date) ->> 'target_signed') = 'true')::text);
  execute v_def;   -- restore
  perform pg_temp.chk('7 restored: back to unsigned', 'false', (private.bp_outcome_stratified(current_date - 30, current_date) ->> 'target_signed'));

  -- 6. SIGNED (rolled back): 22 people, home mean 138/88 (uncontrolled on 135/85), clinic readings 138/88 (controlled on 140/90)
  for i in 1..22 loop
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

  select id into v_staff from public.clinical_staff limit 1;
  if v_staff is null then
    insert into w25_results values ('6 SKIPPED: no clinical_staff row exists to sign with', 'skipped', 'run', 'FAIL');
  else
    update public.bp_target_config set approved_by = v_staff, approved_at = now(), is_active = true where version = 1;
    v_json := private.bp_outcome_stratified(current_date - 1, current_date);
    perform pg_temp.chk('6a signed: target_signed true', 'true', (v_json ->> 'target_signed'));
    select s into v_row from jsonb_array_elements(v_json -> 'strata') s where s ->> 'context' = 'home_self' and s ->> 'source' = 'manual' and not (s ? 'suppressed') limit 1;
    perform pg_temp.chk('6b the home stratum is judged on the HOME line: all uncontrolled', '0/22', (v_row ->> 'controlled') || '/' || (v_row ->> 'uncontrolled'));
    select s into v_row from jsonb_array_elements(v_json -> 'strata') s where s ->> 'context' = 'clinic' and not (s ? 'suppressed') limit 1;
    perform pg_temp.chk('6c the clinic stratum is judged on the CLINIC line: all controlled', '22/0', (v_row ->> 'controlled') || '/' || (v_row ->> 'uncontrolled'));
    perform pg_temp.chk('6d no stratum mixes the two contexts', '0', (select count(*)::text from jsonb_array_elements(v_json -> 'strata') s where s ->> 'context' not in ('home_self', 'clinic', 'unlabelled', 'home_assisted', 'pharmacy', 'diary')));
  end if;

  -- closure
  perform pg_temp.chk('8 the private objects are closed to API roles', 'false/false/false/false',
    has_function_privilege('anon', 'private.bp_outcome_stratified(date, date)', 'EXECUTE')::text || '/'
    || has_function_privilege('authenticated', 'private.bp_outcome_stratified(date, date)', 'EXECUTE')::text || '/'
    || has_table_privilege('authenticated', 'private.v_bp_readings_all', 'SELECT')::text || '/'
    || has_function_privilege('anon', 'public.get_bp_target_config()', 'EXECUTE')::text);
end $$;

select * from w25_results order by check_name;
do $$ begin
  if exists (select 1 from w25_results where verdict <> 'PASS') then raise exception 'w25 proof FAILED: %', (select string_agg(check_name, '; ') from w25_results where verdict <> 'PASS'); end if;
end $$;
rollback;
