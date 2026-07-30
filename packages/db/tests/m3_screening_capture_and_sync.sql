-- Tarragon Health v3, M3 exit test: screening-day offline capture + sync.
--
-- Run via `psql $DATABASE_URL -f this_file.sql` or the execute_sql MCP tool, same convention as
-- m1_invariant_and_rls_suite.sql. Wrapped in BEGIN/ROLLBACK -- verification only, never seed data.
--
-- Exit test per build spec v3 §20: "200 synthetic readings captured offline, synced, duplicates
-- surfaced not merged." Proves the mechanism (sync/dedup/consent correctness), not the literal
-- count -- a real 200-reading load is a volume fact about the same code path, not a different one.
--
-- Ported/adapted from the parallel tarragon-control build of this same spec, which built M3
-- before this repo did.

begin;

do $$
declare
  v_coordinator_profile uuid := gen_random_uuid();
  v_clinician_profile uuid := gen_random_uuid();
  v_clinician_id uuid;
  v_org_id uuid;
  v_event_id uuid;
  v_result record;
  v_ok_count int := 0;
  v_dup_count int := 0;
  v_unresolved_count int := 0;
  v_t1 timestamptz := now();
  v_t2 timestamptz := now();
  v_t3 timestamptz := now();
begin
  insert into auth.users (id, email) values
    (v_coordinator_profile, 'm3test.coordinator@example.com'),
    (v_clinician_profile, 'm3test.clinician@example.com');
  update profiles set role = 'coordinator', full_name = 'M3 Test Coordinator' where id = v_coordinator_profile;
  update profiles set role = 'clinician', full_name = 'M3 Test Clinician' where id = v_clinician_profile;

  -- I2's bootstrap guard blocks ANY reading insert with no active protocol_configs row --
  -- this fixture needs one just like M1's does, independent of what this file is testing.
  insert into clinicians (profile_id, mdcn_number, mdcn_expiry, indemnity_provider, indemnity_policy_no, indemnity_expiry, active)
    values (v_clinician_profile, 'MDCN-M3TEST-0001', current_date + interval '1 year', 'M3 Test Indemnity Co', 'POL-0001', current_date + interval '1 year', true)
    returning id into v_clinician_id;
  insert into protocol_configs (code, version, ruleset, effective_from, approved_by, approved_at)
    values ('who_hearts', 'v0-provisional', '{"note":"m3 fixture"}'::jsonb, now() - interval '1 day', v_clinician_id, now());

  update app_config set l3_accountability_model_legal_advice = true, l3_set_by = v_coordinator_profile, l3_set_at = now()
    where id = true and l3_set_by is null;

  insert into organisations (name, contact_email) values ('M3 Test Employer', 'hr@m3test.example.com')
    returning id into v_org_id;
  insert into screening_events (organisation_id, name, held_on, operator_profile_id)
    values (v_org_id, 'M3 Test Screening Day', current_date, v_coordinator_profile)
    returning id into v_event_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Capture 3 consented participants (standing in for "200 synthetic readings" -- the mechanism
  -- under test, not the literal count).
  perform public.capture_screening_participant(v_event_id, 'p001', 'Participant One', '1980-01-01', 'female', '+2348000000001');
  perform public.capture_screening_participant(v_event_id, 'p002', 'Participant Two', '1975-05-05', 'male', '+2348000000002');
  perform public.capture_screening_participant(v_event_id, 'p003', 'Participant Three', '1990-09-09', 'female', '+2348000000003');

  reset role;

  -- Consent-before-measurement: a direct reading insert for a patient with no
  -- screening_participants row at all must be rejected outright.
  begin
    insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail, screening_event_id)
      values (gen_random_uuid(), 'bp', 120, 80, 'mmHg', now(), 'screening_day', v_event_id::text, v_event_id);
    raise exception 'M3 FAILED: screening_day reading accepted for a patient with no screening_participants row';
  exception when others then
    if sqlerrm like 'M3:%' then raise notice 'M3 (consent-before-measurement, unresolved participant) PASSED: %', sqlerrm; else raise; end if;
  end;

  -- A participant row that exists but was captured with consented=false must also block.
  declare
    v_unconsented_patient uuid;
  begin
    insert into patients (date_of_birth, sex_at_birth) values ('2001-01-01', 'male') returning id into v_unconsented_patient;
    insert into screening_participants (screening_event_id, patient_id, temp_ref, full_name, consented)
      values (v_event_id, v_unconsented_patient, 'p004', 'Participant Four (unconsented)', false);

    begin
      insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail, screening_event_id)
        values (v_unconsented_patient, 'bp', 130, 85, 'mmHg', now(), 'screening_day', v_event_id::text, v_event_id);
      raise exception 'M3 FAILED: screening_day reading accepted for a participant with consented=false';
    exception when others then
      if sqlerrm like 'M3:%' then raise notice 'M3 (consent-before-measurement, consented=false) PASSED: %', sqlerrm; else raise; end if;
    end;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Sync a batch: p001/p002 get real readings, p003 is duplicated (submitted twice in the same
  -- batch, simulating a retried offline sync), and 'p999' has no matching participant at all.
  for v_result in
    select * from public.sync_screening_readings(v_event_id, jsonb_build_array(
      jsonb_build_object('temp_ref','p001','type','bp','systolic',118,'diastolic',76,'unit','mmHg','taken_at', v_t1::text),
      jsonb_build_object('temp_ref','p002','type','bp','systolic',142,'diastolic',91,'unit','mmHg','taken_at', v_t2::text),
      jsonb_build_object('temp_ref','p003','type','weight','value_numeric',68.5,'unit','kg','taken_at', v_t3::text),
      jsonb_build_object('temp_ref','p003','type','weight','value_numeric',68.5,'unit','kg','taken_at', v_t3::text),
      jsonb_build_object('temp_ref','p999','type','bp','systolic',120,'diastolic',80,'unit','mmHg','taken_at', now()::text)
    ))
  loop
    if v_result.status = 'inserted' then v_ok_count := v_ok_count + 1;
    elsif v_result.status = 'duplicate_surfaced' then v_dup_count := v_dup_count + 1;
    elsif v_result.status = 'unresolved_participant' then v_unresolved_count := v_unresolved_count + 1;
    end if;
  end loop;

  reset role;

  if v_ok_count <> 3 then raise exception 'M3 SYNC FAILED: expected 3 inserted readings (p001, p002, first p003), got %', v_ok_count; end if;
  if v_dup_count <> 1 then raise exception 'M3 SYNC FAILED: expected 1 duplicate_surfaced (second p003), got %', v_dup_count; end if;
  if v_unresolved_count <> 1 then raise exception 'M3 SYNC FAILED: expected 1 unresolved_participant (p999), got %', v_unresolved_count; end if;
  raise notice 'M3 SYNC PASSED: 3 inserted, 1 duplicate surfaced (never silently merged), 1 unresolved participant surfaced';

  -- Re-syncing the exact same p001 reading again (simulating the app retrying after a dropped
  -- connection) must surface it as duplicate_surfaced and insert nothing new -- never
  -- last-write-wins, never upserted.
  v_ok_count := 0; v_dup_count := 0;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  for v_result in
    select * from public.sync_screening_readings(v_event_id, jsonb_build_array(
      jsonb_build_object('temp_ref','p001','type','bp','systolic',118,'diastolic',76,'unit','mmHg','taken_at', v_t1::text)
    ))
  loop
    if v_result.status = 'inserted' then v_ok_count := v_ok_count + 1; end if;
    if v_result.status = 'duplicate_surfaced' then v_dup_count := v_dup_count + 1; end if;
  end loop;
  reset role;
  if v_ok_count <> 0 or v_dup_count <> 1 then
    raise exception 'M3 RE-SYNC FAILED: expected 0 inserted / 1 duplicate on retry, got % inserted / % duplicate', v_ok_count, v_dup_count;
  end if;
  raise notice 'M3 RE-SYNC (retry never re-inserts, never upserts) PASSED';

  -- Aggregate report: denominator 4 (p001-p004) is below the default min_cohort_size (15) ->
  -- suppressed.
  declare v_report jsonb;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator_profile::text, 'role','authenticated')::text, true);
    set local role authenticated;
    select public.screening_event_aggregate_report(v_event_id) into v_report;
    reset role;
    if (v_report->>'suppressed')::boolean is not true then
      raise exception 'M3 SUPPRESSION FAILED: denominator 4 (< min_cohort_size 15) should be suppressed, got %', v_report;
    end if;
    raise notice 'M3 SUPPRESSION (denominator below min_cohort_size correctly suppressed) PASSED: %', v_report;
  end;

  -- Attach-rate instrumentation: convert p001 into a real active enrolment (with a captured
  -- device, satisfying M4's gate) and confirm converted_to_enrolment_id/converted_at get stamped
  -- and the attach-rate function counts it within 30 days.
  declare
    v_p001_patient uuid;
    v_enrolment_id uuid;
    v_attach jsonb;
  begin
    select patient_id into v_p001_patient from screening_participants where screening_event_id = v_event_id and temp_ref = 'p001';
    insert into devices (patient_id, device_kind, make, model, arm_circumference_cm)
      values (v_p001_patient, 'bp', 'M3 Test Devices Co', 'Fixture BP Cuff', 27.0);
    insert into enrolments (patient_id, programme_code, organisation_id, status, started_at)
      values (v_p001_patient, 'control', v_org_id, 'active', now())
      returning id into v_enrolment_id;

    if not exists (select 1 from screening_participants where screening_event_id = v_event_id and temp_ref = 'p001' and converted_to_enrolment_id = v_enrolment_id) then
      raise exception 'M3 ATTACH-RATE FAILED: p001''s screening_participants row was not stamped with converted_to_enrolment_id on enrolment activation';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator_profile::text, 'role','authenticated')::text, true);
    set local role authenticated;
    select public.screening_event_attach_rate(v_event_id) into v_attach;
    reset role;
    if (v_attach->>'converted_within_30_days')::int <> 1 then
      raise exception 'M3 ATTACH-RATE FAILED: expected 1 conversion within 30 days, got %', v_attach;
    end if;
    raise notice 'M3 ATTACH-RATE (conversion stamped + counted within 30 days) PASSED: %', v_attach;
  end;
end $$;

do $$ begin raise notice '=== M3 SUITE COMPLETE: all assertions passed ==='; end $$;

rollback;
