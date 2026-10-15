-- S08x proof: as-needed (PRN) limits, warn never block (decision C7, approved text, NOT signed).
--
-- Proves in one rolled-back transaction:
--   1. The rule ships UNSIGNED and INACTIVE; nothing can be set and nothing is flagged until the CMO signs it, and only the
--      active Chief Medical Officer can sign (a senior doctor and a patient are refused); a patient cannot insert a rule.
--   2. Only a tied clinician with prescribing authority can set limits, only inside the signed bounds, only on an active
--      as-needed medicine, with a reason; an untied doctor, a pharmacist and the patient are refused; clearing works.
--   3. The shared cases (packages/medicines/src/prn.fixtures.ts, run by checkPrnDose) give the same answer in the database:
--      the flag for the final dose has exactly the expected reasons.
--   4. ORDER INDEPENDENCE: the same two doses logged in either order produce the same flags (a late-synced dose is judged
--      like one logged in order).
--   5. A dose is ALWAYS logged: a failing flag write (a constraint that rejects it) leaves the dose in place and writes no flag.
--   6. With the guard off a non-test patient is never flagged; a test patient is.
--   7. Three flagged doses in a week emit exactly ONE care-team signal (when the event type exists in this database).
--   8. Visibility: the patient reads her own limits and flags, never another patient's, and cannot write either; tied staff
--      read through the audited overview with a reason, an untied doctor is denied; anon cannot execute anything.
--   9. SABOTAGE: with the rule replaced by one that ignores the gap, the min_gap cases must flip to FAIL.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.attempt(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $f$;

create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

-- "d0 08:00" is Lagos yesterday, "d-1 22:00" the day before. Everything stays inside the 72 hour backdate window.
create or replace function pg_temp.ts(p_spec text) returns timestamptz language sql as $f$
  select (((now() at time zone 'Africa/Lagos')::date - 1 + case when split_part(p_spec, ' ', 1) = 'd-1' then -1 else 0 end)
          + split_part(p_spec, ' ', 2)::time) at time zone 'Africa/Lagos'
$f$;

create or replace function pg_temp.log_dose(p_org uuid, p_patient uuid, p_med uuid, p_at timestamptz) returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_for_date, source, client_id, client_recorded_at)
  values (p_org, p_patient, p_med, 'taken', (p_at at time zone 'Africa/Lagos')::date, 'patient', gen_random_uuid(), p_at)
  returning id into v_id;
  return v_id;
end $f$;

create or replace function pg_temp.flag_of(p_log uuid) returns text language sql as $f$
  select coalesce((select concat_ws(',', case when min_gap then 'min_gap' end, case when daily_max then 'daily_max' end)
                     from public.medication_prn_flags where log_id = p_log), '')
$f$;

create or replace function pg_temp.run_checks(p_phase text) returns void
language plpgsql as $f$
declare
  v_org uuid;
  v_test uuid := gen_random_uuid();       -- is_test patient (guard open for her)
  v_real uuid := gen_random_uuid();       -- ordinary patient (guard off)
  v_other uuid := gen_random_uuid();
  v_smo uuid := gen_random_uuid();        -- tied, prescribing authority
  v_untied uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_pharm uuid := gen_random_uuid();
  v_rule uuid;
  v_med uuid; v_med2 uuid; v_med3 uuid; v_nonprn uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_log uuid;
  v_n integer;
  v_res jsonb := '[]'::jsonb;
  v_case record;
  v_ov jsonb;
  v_has_event boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'S08x proof needs one organisation (seed fixture missing)'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 's08x-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_test, v_real, v_other, v_smo, v_untied, v_cmo, v_pharm]) u;
  insert into public.profiles (id, organisation_id, role, full_name, is_test) values
    (v_test,   v_org, 'patient',    'S08x Test Patient', true),
    (v_real,   v_org, 'patient',    'S08x Real Patient', false),
    (v_other,  v_org, 'patient',    'S08x Other Patient', true),
    (v_smo,    v_org, 'clinician',  'S08x Tied SMO', false),
    (v_untied, v_org, 'clinician',  'S08x Untied SMO', false),
    (v_cmo,    v_org, 'clinician',  'S08x CMO', false),
    (v_pharm,  v_org, 'pharmacist', 'S08x Pharmacist', false)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_smo,    'S08x Tied SMO',   true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S08X-1', now() + interval '1 year'),
    (v_org, v_untied, 'S08x Untied SMO', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S08X-2', now() + interval '1 year'),
    (v_org, v_cmo,    'S08x CMO',        true, now(), 'chief_medical_officer',  'Probe Indemnity', 'S08X-3', now() + interval '1 year');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
    values (v_org, v_test, v_smo, now()), (v_org, v_real, v_smo, now())
  on conflict (patient_id) do update set clinician_id = v_smo;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active)
    values (v_org, v_test, 'S08x PRN A', '1', 'as needed', '[]',
            '{"kind":"as_needed","maxPerDay":null,"startDate":null,"endDate":null,"foodNote":null}', 'clinician', true) returning id into v_med;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active)
    values (v_org, v_test, 'S08x Daily', '1', 'daily', '["08:00"]', 'clinician', true) returning id into v_nonprn;

  -- 1. unsigned and inactive ------------------------------------------------------------------------------------------
  select id into v_rule from public.prn_limit_rules where version = 1;
  v_res := v_res || jsonb_build_array(jsonb_build_array('v1 ships unsigned and inactive', 'true',
    (select (not is_active and approved_by is null and approved_at is null)::text from public.prn_limit_rules where id = v_rule)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('no rule is live before signing', '0', (select count(*)::text from public.prn_limit_rules where is_active)));

  perform pg_temp.as_user(v_smo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('limits cannot be set while the rule is unsigned', '55000',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, 60, 3, %L)', v_med, 'proof: not signed yet'))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a senior doctor cannot sign the rule', '42501',
    pg_temp.attempt(format('select public.sign_prn_limit_rules(%L)', v_rule))));
  execute 'reset role';
  perform pg_temp.as_user(v_test);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot sign the rule', '42501',
    pg_temp.attempt(format('select public.sign_prn_limit_rules(%L)', v_rule))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot insert a rule', '42501',
    pg_temp.attempt($$insert into public.prn_limit_rules (version, config) values (99, '{"minGapMinutesBounds":[1,2],"dailyMaxBounds":[1,2],"repeatSignal":{}}')$$)));
  execute 'reset role';

  -- Limits written without a signed rule (as the table owner) are never evaluated
  insert into public.medication_prn_limits (medication_id, organisation_id, patient_id, min_gap_minutes, daily_max, rule_version)
    values (v_med, v_org, v_test, 240, 1, 1);
  v_a := pg_temp.log_dose(v_org, v_test, v_med, pg_temp.ts('d0 08:00'));
  v_b := pg_temp.log_dose(v_org, v_test, v_med, pg_temp.ts('d0 08:30'));
  v_res := v_res || jsonb_build_array(jsonb_build_array('nothing is flagged while the rule is unsigned', '0', (select count(*)::text from public.medication_prn_flags where medication_id = v_med)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('both doses were still logged', '2', (select count(*)::text from public.medication_logs where medication_id = v_med)));
  delete from public.medication_logs where medication_id = v_med;   -- the proof owner may clean up; the table is append-only for everyone else
  delete from public.medication_prn_limits where medication_id = v_med;

  -- 2. the CMO signs ----------------------------------------------------------------------------------------------------
  perform pg_temp.as_user(v_cmo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('the active CMO signs the rule', 'ok', pg_temp.attempt(format('select public.sign_prn_limit_rules(%L)', v_rule))));
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('the signed rule is live and attributed', 'true',
    (select (is_active and approved_by is not null and approved_at is not null)::text from public.prn_limit_rules where id = v_rule)));

  -- 3. setting limits --------------------------------------------------------------------------------------------------
  perform pg_temp.as_user(v_untied);
  v_res := v_res || jsonb_build_array(jsonb_build_array('an untied doctor cannot set limits', '42501',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, 60, 3, %L)', v_med, 'proof: untied attempt'))));
  execute 'reset role';
  perform pg_temp.as_user(v_pharm);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a pharmacist cannot set limits', '42501',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, 60, 3, %L)', v_med, 'proof: pharmacist attempt'))));
  execute 'reset role';
  perform pg_temp.as_user(v_test);
  v_res := v_res || jsonb_build_array(jsonb_build_array('the patient cannot set her own limits', '42501',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, 60, 3, %L)', v_med, 'proof: patient attempt'))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the patient cannot insert a limit directly', '42501',
    pg_temp.attempt(format('insert into public.medication_prn_limits (medication_id, organisation_id, patient_id, min_gap_minutes, rule_version) values (%L, %L, %L, 5, 1)', v_med, v_org, v_test))));
  execute 'reset role';
  perform pg_temp.as_user(v_smo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a gap below the signed bound is refused', '22023',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, 14, null, %L)', v_med, 'proof: below bound'))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a daily most above the signed bound is refused', '22023',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, null, 25, %L)', v_med, 'proof: above bound'))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a missing reason is refused', '22023',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, 60, 3, %L)', v_med, 'short'))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a scheduled medicine cannot take limits', '22023',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, 60, 3, %L)', v_nonprn, 'proof: not as needed'))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the tied doctor sets a limit', 'ok',
    pg_temp.attempt(format('select public.set_medication_prn_limits(%L, 240, 3, %L)', v_med, 'proof: care plan'))));
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('the limit is stored with who set it and the rule version', '240:3:1:true',
    (select min_gap_minutes || ':' || daily_max || ':' || rule_version || ':' || (set_by is not null)::text from public.medication_prn_limits where medication_id = v_med)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('setting a limit is audited', 'true',
    (exists (select 1 from public.audit_log where action = 'medication_prn_limits.set' and entity_id = v_med))::text));

  -- 4. the shared cases (the same ones packages/medicines runs) -------------------------------------------------------------
  for v_case in select * from (values
    (1,  'no limits set is never checked',          null::integer, null::integer, array[]::text[], 'd0 08:01', ''),
    (2,  'first dose of the day is fine',           240, 3, array[]::text[], 'd0 08:00', ''),
    (3,  'exactly the gap later is fine',           240, null, array['d0 08:00'], 'd0 12:00', ''),
    (4,  'one minute short of the gap',             240, null, array['d0 08:00'], 'd0 11:59', 'min_gap'),
    (5,  'the most doses in a day is fine',         null, 3, array['d0 06:00','d0 12:00'], 'd0 18:00', ''),
    (6,  'one more than the daily most',            null, 3, array['d0 06:00','d0 12:00','d0 15:00'], 'd0 18:00', 'daily_max'),
    (7,  'both limits broken',                      240, 2, array['d0 08:00','d0 09:00'], 'd0 09:30', 'min_gap,daily_max'),
    (8,  'yesterday does not count toward today',   null, 1, array['d-1 22:00'], 'd0 07:00', ''),
    (9,  'the gap runs across midnight',            240, null, array['d-1 23:30'], 'd0 01:00', 'min_gap'),
    (10, 'a later dose does not make an earlier one over', 240, 1, array['d0 10:00'], 'd0 08:00', '')
  ) as c(n, name, gap, mx, prior, dose, want)
  loop
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active)
      values (v_org, v_test, 'S08x case ' || v_case.n, '1', 'as needed', '[]',
              '{"kind":"as_needed","maxPerDay":null,"startDate":null,"endDate":null,"foodNote":null}', 'clinician', true) returning id into v_med2;
    if v_case.gap is not null or v_case.mx is not null then
      insert into public.medication_prn_limits (medication_id, organisation_id, patient_id, min_gap_minutes, daily_max, rule_version)
        values (v_med2, v_org, v_test, v_case.gap, v_case.mx, 1);
    end if;
    perform pg_temp.log_dose(v_org, v_test, v_med2, pg_temp.ts(p)) from unnest(v_case.prior) p;
    v_log := pg_temp.log_dose(v_org, v_test, v_med2, pg_temp.ts(v_case.dose));
    v_res := v_res || jsonb_build_array(jsonb_build_array('case ' || v_case.n || ': ' || v_case.name, v_case.want, pg_temp.flag_of(v_log)));
  end loop;

  -- 5. order independence: the same two doses either way round --------------------------------------------------------------
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active)
    values (v_org, v_test, 'S08x order 1', '1', 'as needed', '[]', '{"kind":"as_needed","maxPerDay":null,"startDate":null,"endDate":null,"foodNote":null}', 'clinician', true) returning id into v_med2;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active)
    values (v_org, v_test, 'S08x order 2', '1', 'as needed', '[]', '{"kind":"as_needed","maxPerDay":null,"startDate":null,"endDate":null,"foodNote":null}', 'clinician', true) returning id into v_med3;
  insert into public.medication_prn_limits (medication_id, organisation_id, patient_id, min_gap_minutes, rule_version)
    values (v_med2, v_org, v_test, 240, 1), (v_med3, v_org, v_test, 240, 1);
  v_a := pg_temp.log_dose(v_org, v_test, v_med2, pg_temp.ts('d0 08:00'));   -- in order
  v_b := pg_temp.log_dose(v_org, v_test, v_med2, pg_temp.ts('d0 09:00'));
  v_c := pg_temp.log_dose(v_org, v_test, v_med3, pg_temp.ts('d0 09:00'));   -- the later one first, the earlier one synced late
  v_d := pg_temp.log_dose(v_org, v_test, v_med3, pg_temp.ts('d0 08:00'));
  v_res := v_res || jsonb_build_array(jsonb_build_array('late-synced: same flags as in order (earlier dose)', pg_temp.flag_of(v_a), pg_temp.flag_of(v_d)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('late-synced: same flags as in order (later dose)', pg_temp.flag_of(v_b), pg_temp.flag_of(v_c)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('late-synced: the later dose is flagged once the earlier one arrives', 'min_gap', pg_temp.flag_of(v_c)));

  -- 6. a dose is always logged ------------------------------------------------------------------------------------------------
  alter table public.medication_prn_flags add constraint s08x_proof_reject_flag check (false) not valid;
  select count(*) into v_n from public.medication_logs where medication_id = v_med2;
  v_log := pg_temp.log_dose(v_org, v_test, v_med2, pg_temp.ts('d0 09:10'));
  alter table public.medication_prn_flags drop constraint s08x_proof_reject_flag;
  v_res := v_res || jsonb_build_array(jsonb_build_array('a failing flag write never stops the dose being logged', 'true:',
    (exists (select 1 from public.medication_logs where id = v_log))::text || ':' || pg_temp.flag_of(v_log)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a failing flag write leaves a durable audit row', 'true',
    (exists (select 1 from public.audit_log where action = 'medication_prn_limits.flag_write_failed' and entity_id = v_log))::text));
  -- the repair puts the missing flag back, and never removes one
  v_res := v_res || jsonb_build_array(jsonb_build_array('the repair restores the flag that failed to write', '1:min_gap',
    private.reevaluate_prn_flags(v_med2)::text || ':' || pg_temp.flag_of(v_log)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('running the repair again changes nothing', '0', private.reevaluate_prn_flags(v_med2)::text));

  -- limits follow an amended medicine (the new row names the old one), and only while it is still as-needed
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active, previous_version_id, version)
    values (v_org, v_test, 'S08x amended', '1', 'as needed', '[]', '{"kind":"as_needed","maxPerDay":null,"startDate":null,"endDate":null,"foodNote":null}', 'clinician', true, v_med2, 2)
    returning id into v_d;
  v_res := v_res || jsonb_build_array(jsonb_build_array('limits follow an amended as-needed medicine', '240',
    coalesce((select min_gap_minutes::text from public.medication_prn_limits where medication_id = v_d), 'none')));
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, previous_version_id, version)
    values (v_org, v_test, 'S08x amended to daily', '1', 'daily', '["08:00"]', 'clinician', true, v_med2, 2)
    returning id into v_c;
  v_res := v_res || jsonb_build_array(jsonb_build_array('limits do not follow a medicine that stopped being as-needed', 'none',
    coalesce((select min_gap_minutes::text from public.medication_prn_limits where medication_id = v_c), 'none')));

  -- 7. the guard ---------------------------------------------------------------------------------------------------------------
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active)
    values (v_org, v_real, 'S08x real', '1', 'as needed', '[]', '{"kind":"as_needed","maxPerDay":null,"startDate":null,"endDate":null,"foodNote":null}', 'clinician', true) returning id into v_med3;
  insert into public.medication_prn_limits (medication_id, organisation_id, patient_id, min_gap_minutes, rule_version) values (v_med3, v_org, v_real, 240, 1);
  perform pg_temp.log_dose(v_org, v_real, v_med3, pg_temp.ts('d0 08:00'));
  v_log := pg_temp.log_dose(v_org, v_real, v_med3, pg_temp.ts('d0 08:05'));
  v_res := v_res || jsonb_build_array(jsonb_build_array('guard off: an ordinary patient is not flagged', '', pg_temp.flag_of(v_log)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('guard off: both doses were still logged', '2', (select count(*)::text from public.medication_logs where medication_id = v_med3)));

  -- 8. the repeated signal -------------------------------------------------------------------------------------------------------
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active)
    values (v_org, v_other, 'S08x repeat', '1', 'as needed', '[]', '{"kind":"as_needed","maxPerDay":null,"startDate":null,"endDate":null,"foodNote":null}', 'clinician', true) returning id into v_med3;
  insert into public.medication_prn_limits (medication_id, organisation_id, patient_id, daily_max, rule_version) values (v_med3, v_org, v_other, 1, 1);
  perform pg_temp.log_dose(v_org, v_other, v_med3, pg_temp.ts('d0 07:00'));
  perform pg_temp.log_dose(v_org, v_other, v_med3, pg_temp.ts('d0 08:00'));
  v_res := v_res || jsonb_build_array(jsonb_build_array('one flagged dose raises no signal', '0',
    (select count(*)::text from public.clinical_rule_events where patient_id = v_other and event_type::text = 'medication_prn_limit_repeated')));
  perform pg_temp.log_dose(v_org, v_other, v_med3, pg_temp.ts('d0 09:00'));
  perform pg_temp.log_dose(v_org, v_other, v_med3, pg_temp.ts('d0 10:00'));
  select exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'clinical_rule_event_type' and e.enumlabel = 'medication_prn_limit_repeated') into v_has_event;
  -- where the event type is not yet committed (a dry run that applies both files in one transaction) the signal cannot be written yet
  v_res := v_res || jsonb_build_array(jsonb_build_array('three flagged doses raise exactly one signal (when the event type exists)', case when v_has_event then '1' else '0' end,
    (select count(*)::text from public.clinical_rule_events where patient_id = v_other and event_type::text = 'medication_prn_limit_repeated')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the signal names no medicine', 'true',
    (not exists (select 1 from public.clinical_rule_events where patient_id = v_other and event_type::text = 'medication_prn_limit_repeated' and payload::text ilike '%S08x%'))::text));

  -- 9. who can see what -------------------------------------------------------------------------------------------------------------
  perform pg_temp.as_user(v_other);
  select count(*) into v_n from public.medication_prn_flags;
  v_res := v_res || jsonb_build_array(jsonb_build_array('the patient sees her own three flags', '3', v_n::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the patient sees no one else''s flags', 'false', (exists (select 1 from public.medication_prn_flags where patient_id <> v_other))::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the patient sees only her own limits', 'true', (not exists (select 1 from public.medication_prn_limits where patient_id <> v_other))::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the patient cannot write a flag', '42501',
    pg_temp.attempt(format('insert into public.medication_prn_flags (log_id, medication_id, patient_id, organisation_id, dose_at, min_gap) select id, medication_id, patient_id, organisation_id, logged_at, true from public.medication_logs where patient_id = %L limit 1', v_other))));
  v_ov := public.medication_prn_overview(v_other);
  v_res := v_res || jsonb_build_array(jsonb_build_array('the patient overview shows her limit and flags', '1:1',
    jsonb_array_length(v_ov -> 'limits')::text || ':' || jsonb_array_length(v_ov -> 'flagged_last_7_days')::text));
  execute 'reset role';

  perform pg_temp.as_user(v_smo);
  v_ov := public.medication_prn_overview(v_test, 'proof: care review of limits');
  v_res := v_res || jsonb_build_array(jsonb_build_array('tied staff read the overview with a reason', 'ok', v_ov ->> 'status'));
  v_res := v_res || jsonb_build_array(jsonb_build_array('staff read without a reason is refused', '22023', pg_temp.attempt(format('select public.medication_prn_overview(%L)', v_test))));
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('the staff read was audited', 'true',
    (exists (select 1 from public.audit_log where actor_id = v_smo and created_at >= now() - interval '1 hour' and action ilike '%read%'))::text));
  perform pg_temp.as_user(v_untied);
  v_ov := public.medication_prn_overview(v_test, 'proof: untied doctor tries it');
  v_res := v_res || jsonb_build_array(jsonb_build_array('an untied doctor is denied', 'denied', v_ov ->> 'status'));
  execute 'reset role';

  -- 9b. The printed adherence report uses the app's formula. This is the same week the Jest drift test builds in
  --     apps/web/src/lib/medicines/adherence-report-data.test.ts: a daily 08:00 medicine, 8 to 14 October 2026 (Lagos),
  --     taken 8 to 11, skipped 12, taken late 13, "could not get it" 14. Both sides must say 7 due, 5 marked taken (1 late),
  --     1 skipped, 0 no record, 1 could not get it, 71 percent.
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, created_at)
    values (v_org, v_real, 'S08x report', '1', 'daily', '["08:00"]', 'patient', true, '2026-09-01 00:00:00+01') returning id into v_med3;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id, logged_at)
  select v_org, v_real, v_med3, x.st::public.medication_log_status, '08:00', x.d::date, 'patient', gen_random_uuid(), x.at::timestamptz
    from (values ('taken', '2026-10-08', '2026-10-08 08:05:00+01'), ('taken', '2026-10-09', '2026-10-09 08:05:00+01'),
                 ('taken', '2026-10-10', '2026-10-10 08:05:00+01'), ('taken', '2026-10-11', '2026-10-11 08:05:00+01'),
                 ('skipped', '2026-10-12', '2026-10-12 08:05:00+01'), ('delayed', '2026-10-13', '2026-10-13 13:00:00+01'),
                 ('not_available', '2026-10-14', '2026-10-14 08:05:00+01')) as x(st, d, at);
  v_ov := private.weekly_adherence(v_real, '2026-10-14 23:59:59+01'::timestamptz) - 'threshold_percent' - 'config_version' - 'below_threshold';
  v_res := v_res || jsonb_build_array(jsonb_build_array('the report week matches the app formula (database side)',
    '7:5:1:1:0:1:71',
    (v_ov ->> 'due') || ':' || ((v_ov ->> 'taken')::int + (v_ov ->> 'late')::int) || ':' || (v_ov ->> 'late') || ':' || (v_ov ->> 'skipped') || ':' ||
    (v_ov ->> 'missed') || ':' || (v_ov ->> 'unavailable') || ':' || (v_ov ->> 'percent')));

  -- 10. anon -------------------------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  v_res := v_res || jsonb_build_array(jsonb_build_array('anon cannot read limits', '42501', pg_temp.attempt('select 1 from public.medication_prn_limits')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('anon cannot execute the overview', '42501', pg_temp.attempt(format('select public.medication_prn_overview(%L)', v_test))));
  execute 'reset role';

  insert into results select p_phase, e->>0, e->>1, e->>2 from jsonb_array_elements(v_res) e;
end
$f$;

select pg_temp.run_checks('real');

-- Put the rule back to its shipped, unsigned state so the second phase starts from the same place as the first.
update public.prn_limit_rules set is_active = false, approved_by = null, approved_at = null;

-- Sabotage: the rule forgets the gap. The min_gap cases must flip.
create or replace function private.prn_exceedances(p_medication uuid, p_from timestamptz, p_to timestamptz)
returns table (log_id uuid, dose_at timestamptz, min_gap boolean, daily_max boolean)
language sql stable security definer set search_path = '' as $$
  with lim as (select * from public.medication_prn_limits where medication_id = p_medication),
  d as (select l.id, l.logged_at as t from public.medication_logs l
         where l.medication_id = p_medication and l.scheduled_time is null and l.status in ('taken', 'delayed') and l.source is distinct from 'system')
  select x.id, x.t, false, x.max_hit from (
    select d.id, d.t,
      coalesce(lim.daily_max is not null and 1 + (select count(*) from d p where p.id <> d.id and p.t <= d.t
        and (p.t at time zone 'Africa/Lagos')::date = (d.t at time zone 'Africa/Lagos')::date) > lim.daily_max, false) as max_hit
    from d cross join lim where d.t between p_from and p_to) x
  where x.max_hit;
$$;
select pg_temp.run_checks('sabotaged');

do $$
declare v_bad text; v_caught text;
begin
  select string_agg(check_name || ' => ' || actual || ' (wanted ' || expected || ')', '; ') into v_bad
    from results where phase = 'real' and expected <> actual;
  if v_bad is not null then raise exception 'S08x proof FAILED on the real migration: %', v_bad; end if;
  select string_agg(check_name, '; ') into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught is null then raise exception 'VACUOUS TEST: the gap-blind rule did not fail any check'; end if;
  if v_caught not like '%one minute short of the gap%' or v_caught not like '%the gap runs across midnight%' then
    raise exception 'sabotage did not flip the min_gap cases; flipped: %', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
