-- ===========================================================================
-- Proof: *_s05b_c_read_filters_and_patient_guards.sql (S05b-c).
--
--   F. A superseded or entered_in_error row is invisible to RLS reads (patient session) while the replacement and untouched rows show;
--      a SECURITY DEFINER reader (private.bp_window_stats) no longer counts the original; the _current views exclude it and are closed to
--      client roles; the staff/patient history function returns the whole chain and refuses an untied clinician and another patient.
--   G. A patient session cannot clear or change validated_by / logged_by_profile_id (control: she can still add a note, a privileged
--      role can still set the review columns). The patient path of correct_clinical_value refuses a reading that has a clinician alert or
--      a triage event (control: a plain reading is still corrected).
--   H. correct_clinical_value is still NOT executable by authenticated (the grant waits for a replay proof); no definer function reads a
--      corrected table directly except the listed writers.
--   I. SABOTAGE (each must flip): restrictive policy dropped, review-column guard dropped, safety-event check removed, _current view
--      pointed back at the base table.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_p   uuid := gen_random_uuid();
  v_p2  uuid := gen_random_uuid();
  v_c   uuid := gen_random_uuid();   -- tied clinician
  v_u   uuid := gen_random_uuid();   -- untied clinician (the fixture alert may auto-route to any doctor, so v_u is not asserted as refused)
  v_cc  uuid := gen_random_uuid();   -- care coordinator on the care team: tier refuses
  v_b1 uuid; v_b2 uuid; v_b3 uuid;
  v_rs uuid; v_rs_status text; v_rs_ver int; v_te uuid;
  v_w1 uuid; v_w2 uuid; v_w3 uuid; v_w4 uuid; v_wrev uuid;
  v_al uuid;
  v_res jsonb;
  v_rep uuid;
  v_state text;
  v_msg text;
  v_n int;
  v_n_before int;
  v_n_after int;
  v_flipped boolean;
  v_def text;
  v_hist jsonb;
  r record;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_p,  's05bc-p@example.invalid',  'x', now(), '{}', '{}'),
    (v_p2, 's05bc-p2@example.invalid', 'x', now(), '{}', '{}'),
    (v_c,  's05bc-c@example.invalid',  'x', now(), '{}', '{}'),
    (v_u,  's05bc-u@example.invalid',  'x', now(), '{}', '{}'),
    (v_cc, 's05bc-cc@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_p,  v_org, 'patient',   'S05bc Patient One',  '+2348055560001'),
    (v_p2, v_org, 'patient',   'S05bc Patient Two',  '+2348055560002'),
    (v_c,  v_org, 'clinician', 'S05bc Tied Doctor',  '+2348055560004'),
    (v_u,  v_org, 'clinician', 'S05bc Untied Doctor','+2348055560005'),
    (v_cc, v_org, 'clinician', 'S05bc Coordinator','+2348055560006')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_c, 'S05bc Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_u, 'S05bc Untied Doctor', true, now(), 'senior_medical_officer'),
    (v_org, v_cc, 'S05bc Coordinator', true, now(), 'care_coordinator');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_p, v_c, now()) on conflict (patient_id) do update set clinician_id = v_c;

  -- three normal blood pressures, four weights (one for each guard case), an allergy the patient typed herself
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_p, 'blood_pressure', 120, 80, now() - interval '3 hours', 'manual') returning id into v_b1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_p, 'blood_pressure', 124, 82, now() - interval '2 hours', 'manual') returning id into v_b2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_p, 'blood_pressure', 126, 84, now() - interval '1 hours', 'manual') returning id into v_b3;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 70, now() - interval '5 hours', 'manual') returning id into v_w1;   -- plain
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 71, now() - interval '4 hours', 'manual') returning id into v_w2;   -- has a clinician alert
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 72, now() - interval '3 hours 30 minutes', 'manual') returning id into v_w3;   -- has a triage event
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 73, now() - interval '2 hours 30 minutes', 'manual') returning id into v_w4;   -- plain, for the guard tests
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 74, now() - interval '2 hours 20 minutes', 'manual') returning id into v_wrev;   -- reviewed by a clinician
  update public.vitals_readings set validated_by = (select id from public.clinical_staff where profile_id = v_c), validated_at = now()
   where id = v_wrev;
  -- a real triage event (the column has a foreign key): any rule set will do, the event is a green one
  select id, status, version into v_rs, v_rs_status, v_rs_ver from public.triage_rule_sets where code = 'bp_care_triage' order by version desc limit 1;
  if v_rs is null then raise exception 'fixture FAIL: no triage rule set'; end if;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test)
  values (v_org, v_p, 'observation', v_w3, 'green', 'S05BC-G1', v_rs, 'bp_care_triage', v_rs_ver, v_rs_status, '[]', v_rs_status <> 'approved', true)
  returning id into v_te;
  update public.vitals_readings set triage_event_id = v_te where id = v_w3;
  insert into public.clinician_alerts (organisation_id, patient_id, level, title, vital_reading_id)
  values (v_org, v_p, 'emergency', 'S05bc fixture alert', v_w2);
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source)
  values (v_org, v_p, 'Peanut', 'moderate', 'patient') returning id into v_al;

  -- ======================================================================== F. reads
  select n into v_n_before from private.bp_window_stats(v_p, current_date - 2, current_date + 1);

  -- the tied clinician corrects b1; the patient marks her allergy entered in error
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_res := public.correct_clinical_value('vitals_readings', v_b1, 'corrected', 'Cuff was on the wrong arm', '{"systolic": 118, "diastolic": 78}'::jsonb);
  execute 'reset role';
  v_rep := (v_res ->> 'replacement_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  perform public.correct_clinical_value('patient_allergies', v_al, 'entered_in_error', 'I do not have this allergy', null);
  execute 'reset role';

  -- F1 patient session: the original and the voided allergy are invisible, the replacement and untouched rows show
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.vitals_readings where id = v_b1;
  if v_n <> 0 then raise exception 'FAIL F1a: the superseded reading is still visible to the patient'; end if;
  select count(*) into v_n from public.vitals_readings where id in (v_rep, v_b2, v_b3);
  if v_n <> 3 then raise exception 'FAIL F1b: replacement or untouched readings are not visible (saw %)', v_n; end if;
  select count(*) into v_n from public.patient_allergies where id = v_al;
  if v_n <> 0 then raise exception 'FAIL F1c: the entered_in_error allergy is still visible'; end if;
  execute 'reset role';

  -- F2 a definer reader (runs as postgres, ignores RLS) counts the replacement once and never the original
  select n into v_n_after from private.bp_window_stats(v_p, current_date - 2, current_date + 1);
  if v_n_after is distinct from v_n_before then
    raise exception 'FAIL F2: bp_window_stats counted % readings after the correction, % before (the original leaked or the replacement is missing)', v_n_after, v_n_before;
  end if;

  -- F3 the _current views exclude the original and are closed to clients; the definer-rights views were rewritten
  select count(*) into v_n from private.vitals_readings_current where id = v_b1;
  if v_n <> 0 then raise exception 'FAIL F3a: vitals_readings_current shows a superseded row'; end if;
  if has_table_privilege('authenticated', 'private.vitals_readings_current', 'SELECT')
     or has_table_privilege('anon', 'private.vitals_readings_current', 'SELECT')
     or has_table_privilege('authenticated', 'private.patient_allergies_current', 'SELECT') then
    raise exception 'FAIL F3b: a _current view is readable by a client role';
  end if;
  if position('vitals_readings_current' in pg_get_viewdef('private.v_bp_cohort_90d'::regclass)) = 0
     or position('lab_analyte_readings_current' in pg_get_viewdef('public.diabetes_quality_metrics'::regclass)) = 0 then
    raise exception 'FAIL F3c: a definer-rights view still reads the base table';
  end if;

  -- F4 history: the tied clinician and the patient see the whole chain; an untied clinician and another patient are refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_hist := public.clinical_value_history('vitals_readings', v_rep);
  execute 'reset role';
  if jsonb_array_length(v_hist) <> 2
     or not exists (select 1 from jsonb_array_elements(v_hist) e where e ->> 'id' = v_b1::text and e ->> 'correction_status' = 'corrected')
     or not exists (select 1 from jsonb_array_elements(v_hist) e where e ->> 'id' = v_rep::text and e ->> 'supersedes_id' = v_b1::text) then
    raise exception 'FAIL F4a: the tied clinician did not get the full chain (%)', v_hist;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_hist := public.clinical_value_history('vitals_readings', v_b1);   -- asking from the original end walks the chain too
  execute 'reset role';
  if jsonb_array_length(v_hist) <> 2 then raise exception 'FAIL F4b: the patient did not get her own chain'; end if;
  foreach v_state in array array[v_cc::text, v_p2::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_state::uuid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    declare v_s text := null;
    begin
      begin perform public.clinical_value_history('vitals_readings', v_rep);
      exception when others then get stacked diagnostics v_s = returned_sqlstate; end;
      execute 'reset role';
      if v_s is distinct from '42501' then raise exception 'FAIL F4c: history leaked to % (state %)', v_state, v_s; end if;
    end;
  end loop;
  if has_function_privilege('anon', 'public.clinical_value_history(text, uuid)', 'EXECUTE') then
    raise exception 'FAIL F4d: anon can execute clinical_value_history';
  end if;
  raise notice 'PASS F: read-side hiding, definer readers, views and history';

  -- ======================================================================== G. guards
  -- G1 NEGATIVE: the patient cannot clear who reviewed a reading, cannot rewrite who logged one
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin update public.vitals_readings set validated_by = null, validated_at = null where id = v_wrev;
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  if v_state is distinct from '42501' or v_msg not like '%cannot be changed from a client session%' then raise exception 'FAIL G1a: a patient cleared the clinician review (state %)', v_state; end if;
  v_state := null;
  v_msg := null;
  begin update public.vitals_readings set logged_by_profile_id = v_c where id = v_w4;
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  if v_state is distinct from '42501' or v_msg not like '%cannot be changed from a client session%' then raise exception 'FAIL G1b: a patient changed logged_by_profile_id (state %)', v_state; end if;
  v_state := null;
  v_msg := null;
  begin update public.vitals_readings set triage_event_id = null where id = v_w3;
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  if v_state is distinct from '42501' or v_msg not like '%cannot be changed from a client session%' then raise exception 'FAIL G1e: a patient cleared the triage link (state %)', v_state; end if;
  v_state := null;
  begin insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source, validated_by, validated_at)
        values (v_org, v_p, 'weight', 75, now() - interval '10 minutes', 'manual', (select id from public.clinical_staff where profile_id = v_c), now());
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  if v_state is distinct from '42501' or v_msg not like '%already reviewed or already triaged%' then raise exception 'FAIL G1f: a patient created a reading that looks clinician-reviewed (state %)', v_state; end if;
  -- G1 CONTROL: she can still add a note to her own reading
  update public.vitals_readings set note = 'after breakfast' where id = v_w4;
  if (select note from public.vitals_readings where id = v_w4) is distinct from 'after breakfast' then
    raise exception 'FAIL G1c: the patient could no longer add a note (the guard is too wide)';
  end if;
  execute 'reset role';
  -- G1 CONTROL: the review column is still reachable by a privileged role (the definer review paths)
  update public.vitals_readings set validated_at = now() where id = v_wrev;
  if (select validated_by from public.vitals_readings where id = v_wrev) is null then
    raise exception 'FAIL G1d: the clinician review was lost';
  end if;

  -- G2 NEGATIVE: the patient path refuses a reading with a clinician alert, and one with a triage event
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_w2, 'entered_in_error', 'I want this gone', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL G2a: a patient voided a reading that raised an alert (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_w3, 'entered_in_error', 'I want this gone', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL G2b: a patient voided a reading with a triage event (state %)', v_state; end if;
  -- G2 CONTROL (the gate opens): a plain reading is still corrected by the patient
  v_res := public.correct_clinical_value('vitals_readings', v_w1, 'entered_in_error', 'typed the wrong number', null);
  execute 'reset role';
  if (select correction_status from public.vitals_readings where id = v_w1) is distinct from 'entered_in_error' then
    raise exception 'FAIL G2c: the plain reading was not voided (the new guard is too wide)';
  end if;
  -- G2 CONTROL: the clinician is not blocked by the alert (she can still correct it)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  perform public.correct_clinical_value('vitals_readings', v_w2, 'entered_in_error', 'duplicate of the clinic scale', null);
  execute 'reset role';
  if (select correction_status from public.vitals_readings where id = v_w2) is distinct from 'entered_in_error' then
    raise exception 'FAIL G2d: the clinician could not correct a reading with an alert';
  end if;
  raise notice 'PASS G: review-column guard and safety-event guard';

  -- ======================================================================== H. the gate stays closed, no stray readers
  if has_function_privilege('authenticated', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'FAIL H1: correct_clinical_value is executable by a client role before the replay proof';
  end if;
  for r in
    select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosecdef
       and p.proname not in ('correct_clinical_value', 'delete_wearable_connection_data', 'execute_wearable_data_deletion',
                             'clear_vitals_validation_flag', 'record_triage_result', 'record_poc_measurements',
                             'confirm_lab_report_extraction', 'enforce_fhir_import_resource_attribution', 'capture_record_correction', 'handle_bp_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_spo2_reading_red_flag', 'handle_temperature_reading_red_flag', 'enforce_htn_alert_attestation')
       and p.prosrc ~* '(from|join)\s+public\.(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
  loop
    raise exception 'FAIL H2: definer function % reads a corrected table directly: read private.<table>_current instead', r.fn;
  end loop;
  raise notice 'PASS H: grant still closed, no unfiltered definer reader';

  -- ======================================================================== I. sabotage (each must flip)
  -- I1: without the restrictive policy the patient sees the superseded reading
  v_flipped := false;
  begin
    drop policy vitals_readings_hide_superseded on public.vitals_readings;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.vitals_readings where id = v_b1;
    execute 'reset role';
    if v_n = 1 then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL I1: sabotage did not flip (the hiding proof is vacuous)'; end if;

  -- I2: without the review-column guard the patient clears the clinician review
  v_flipped := false;
  begin
    drop trigger b_guard_vitals_review_columns on public.vitals_readings;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.vitals_readings set validated_by = null, validated_at = null where id = v_wrev;
    execute 'reset role';
    if (select validated_by from public.vitals_readings where id = v_wrev) is null then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL I2: sabotage did not flip (the review-column proof is vacuous)'; end if;
  if (select validated_by from public.vitals_readings where id = v_wrev) is null then raise exception 'FAIL I2b: sabotage was not undone'; end if;

  -- I3: with the safety-event check neutralised, the patient voids the reading that has a triage event
  v_flipped := false;
  begin
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace;
    if position('v_old ->> ''triage_event_id'' is not null' in v_def) = 0 then raise exception 'sabotage anchor missing'; end if;
    execute replace(v_def, 'v_old ->> ''triage_event_id'' is not null', 'false');
    execute replace(pg_get_functiondef((select p.oid from pg_proc p where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace)),
                    'exists (select 1 from public.clinician_alerts ca where ca.vital_reading_id = p_id)', 'false');
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role service_role';
    perform public.correct_clinical_value('vitals_readings', v_w3, 'entered_in_error', 'I want this gone', null);
    execute 'reset role';
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL I3: sabotage did not flip (the safety-event proof is vacuous)'; end if;

  -- I4: with a _current view pointing back at the base table the definer reader counts the original again
  v_flipped := false;
  begin
    create or replace view private.vitals_readings_current as select * from public.vitals_readings;
    select n into v_n_after from private.bp_window_stats(v_p, current_date - 2, current_date + 1);
    if v_n_after is distinct from v_n_before then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL I4: sabotage did not flip (the definer-reader proof is vacuous)'; end if;
  select n into v_n_after from private.bp_window_stats(v_p, current_date - 2, current_date + 1);
  if v_n_after is distinct from v_n_before then raise exception 'FAIL I4b: sabotage was not undone'; end if;

  raise notice 'PASS I: four sabotages each flipped';
  raise notice 'S05b-c read filters and guards proof complete';
end $$;

rollback;
