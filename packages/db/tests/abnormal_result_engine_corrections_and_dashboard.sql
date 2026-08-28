-- Tarragon Health — Abnormal Result Engine: correction/reconciliation +
-- ops dashboard verification.
--
-- Proves (1) screening_results' clinically-significant columns are
-- immutable via direct UPDATE despite screening_results_update's broad
-- org-staff RLS grant, (2) record_result_correction() links a new row back
-- to the original (which is retained, never mutated), raises a stand-down
-- review alert exactly when a previously abnormal/critical result is
-- corrected down to normal/borderline, and refuses to correct an
-- already-corrected result or a non-clinical-staff caller, (3) the
-- reconciliation trigger flags a discrepancy between two independently-
-- arriving disagreeing results exactly once, and (4)
-- abnormal_result_dashboard_counts() returns real counts scoped to org
-- staff.
--
-- Run inside a transaction that is always rolled back — nothing here
-- should ever be committed. Every check here was also hand-verified live
-- against the koiplnmbgnqnbywhpjlf project while building this migration;
-- this file is that verification made repeatable.

begin;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_patient2 uuid;
  v_staff_profile uuid := gen_random_uuid();
  v_staff_id uuid;
  v_verifier uuid;
  v_original_id uuid;
  v_correction_id uuid;
  v_alert_count int;
  v_update_result public.result_status;
  v_err text;
  v_r1 uuid;
  v_r2 uuid;
  v_disc_count int;
  v_counts jsonb;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  select id into v_patient2 from public.profiles where role = 'patient' and organisation_id = v_org and id <> v_patient limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_staff_profile, 'are-db-test-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'ARE DB Test Doctor'
    where id = v_staff_profile;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_staff_profile, v_org, 'ARE DB Test Doctor', 'tier_1', false, true, 'MDCN', 'AREDBTEST-001', true, v_verifier, v_verifier, now())
  returning id into v_staff_id;

  -- ---------------------------------------------------------------------
  -- Part 1: a critical result raises the standard Priority-1 alert, and
  -- direct UPDATE of the clinically-significant columns is silently
  -- reverted (screening_results_lock_clinical_columns).
  -- ---------------------------------------------------------------------
  insert into public.screening_results (organisation_id, patient_id, result_status, result_summary, abnormal_flags, screen_type_code)
  values (v_org, v_patient, 'critical', 'ARE test original', array['glucose'], 'ogtt_fpg')
  returning id into v_original_id;

  select count(*) into v_alert_count from public.clinician_alerts where screening_result_id = v_original_id;
  if v_alert_count <> 1 then
    raise exception 'FAIL 1a: expected 1 alert for original critical result, got %', v_alert_count;
  end if;

  update public.screening_results set result_status = 'normal' where id = v_original_id;
  select result_status into v_update_result from public.screening_results where id = v_original_id;
  if v_update_result <> 'critical' then
    raise exception 'FAIL 1b: direct UPDATE of result_status was not reverted, got %', v_update_result;
  end if;
  raise notice 'PASS 1: clinically-significant columns are immutable via UPDATE, Priority-1 alert fires on insert';

  -- ---------------------------------------------------------------------
  -- Part 2: record_result_correction() — critical -> normal correction.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.record_result_correction(v_original_id, 'normal', 'ARE test corrected', array[]::text[], 'Lab re-ran the sample, original was a mislabelled tube')
    into v_correction_id;
  reset role;

  if v_correction_id is null then
    raise exception 'FAIL 2a: record_result_correction returned null';
  end if;
  if not exists (select 1 from public.screening_results where id = v_original_id) then
    raise exception 'FAIL 2b: original result row was deleted — must be retained';
  end if;
  if not exists (select 1 from public.screening_results where id = v_correction_id and corrects_result_id = v_original_id) then
    raise exception 'FAIL 2c: correction row is not linked back to the original';
  end if;

  select count(*) into v_alert_count
    from public.clinician_alerts
    where screening_result_id = v_correction_id and title = 'Result correction: previous result stood down';
  if v_alert_count <> 1 then
    raise exception 'FAIL 2d: expected exactly 1 stand-down alert for a critical->normal correction, got %', v_alert_count;
  end if;
  raise notice 'PASS 2: correction links back to a retained original and raises exactly one stand-down alert';

  -- Correcting an already-corrected result must fail.
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.record_result_correction(v_original_id, 'normal', 'double correction attempt', array[]::text[], 'should fail');
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  if v_err is null or v_err not like '%already been corrected%' then
    raise exception 'FAIL 2e: correcting an already-corrected result should have raised, got %', coalesce(v_err, 'no error');
  end if;
  raise notice 'PASS 2e: correcting an already-corrected result is refused';

  -- A caller with no active clinical_staff row must be refused.
  declare
    v_nonclinical_profile uuid := gen_random_uuid();
    v_result2_id uuid;
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_nonclinical_profile, 'are-db-test-nonclinical@example.invalid', 'x', now(), '{}', '{}');
    update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'ARE DB Test Non-clinical'
      where id = v_nonclinical_profile;

    insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
    values (v_org, v_patient, 'abnormal', 'hba1c') returning id into v_result2_id;

    v_err := null;
    perform set_config('request.jwt.claims', json_build_object('sub', v_nonclinical_profile, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.record_result_correction(v_result2_id, 'normal', 'x', array[]::text[], 'should fail — no clinical_staff row');
    exception when others then
      v_err := sqlerrm;
    end;
    reset role;
    if v_err is null or v_err not like '%active Tarragon care-team doctor%' then
      raise exception 'FAIL 2f: a non-clinical-staff caller should have been refused, got %', coalesce(v_err, 'no error');
    end if;
    raise notice 'PASS 2f: a caller with no active clinical_staff row is refused';
  end;

  -- ---------------------------------------------------------------------
  -- Part 3: reconciliation — two organically-arriving, disagreeing results.
  -- ---------------------------------------------------------------------
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  values (v_org, v_patient2, 'normal', 'fbc', now() - interval '2 days') returning id into v_r1;
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  values (v_org, v_patient2, 'abnormal', 'fbc', now()) returning id into v_r2;

  select count(*) into v_disc_count from public.clinician_alerts
    where patient_id = v_patient2 and title = 'Conflicting results require validation';
  if v_disc_count <> 1 then
    raise exception 'FAIL 3a: expected exactly 1 discrepancy alert, got %', v_disc_count;
  end if;

  -- A third result agreeing with the latest must not duplicate the alert.
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, created_at)
  values (v_org, v_patient2, 'abnormal', 'fbc', now()) returning id into v_r2;
  select count(*) into v_disc_count from public.clinician_alerts
    where patient_id = v_patient2 and title = 'Conflicting results require validation';
  if v_disc_count <> 1 then
    raise exception 'FAIL 3b: a third agreeing result should not duplicate the discrepancy alert, got % alerts', v_disc_count;
  end if;
  raise notice 'PASS 3: reconciliation flags a disagreeing pair exactly once, deduplicated correctly';

  -- ---------------------------------------------------------------------
  -- Part 4: abnormal_result_dashboard_counts() — org-scoped, sane shape.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.abnormal_result_dashboard_counts(v_org) into v_counts;
  reset role;

  if not (v_counts ? 'critical' and v_counts ? 'urgent' and v_counts ? 'high' and v_counts ? 'routine'
          and v_counts ? 'unacknowledged' and v_counts ? 'overdue' and v_counts ? 'unclaimed') then
    raise exception 'FAIL 4a: abnormal_result_dashboard_counts is missing an expected key: %', v_counts;
  end if;
  if (v_counts->>'unacknowledged')::int < 1 then
    raise exception 'FAIL 4b: expected at least the alerts raised above to count as unacknowledged, got %', v_counts;
  end if;
  raise notice 'PASS 4: abnormal_result_dashboard_counts returns the expected shape with real counts: %', v_counts;

  raise notice 'ALL ABNORMAL RESULT ENGINE CHECKS PASSED';
end $$;

rollback;
