-- Tarragon Health v3, M4 exit test: device validation gate + enrolment device-capture gate.
--
-- Run via `psql $DATABASE_URL -f this_file.sql` or the execute_sql MCP tool, same convention as
-- m1_invariant_and_rls_suite.sql. Wrapped in BEGIN/ROLLBACK -- verification only, never seed data.
--
-- Exit test per build spec v3 §20: "I2 and I3 tests pass; enrolment blocked without a captured
-- device." I2/I3 are already covered by m1_invariant_and_rls_suite.sql (I2 was satisfied at M1,
-- ahead of schedule per that suite's own note) -- this file covers what M4 actually adds: the
-- three device-validation rules (§5.4) and the enrolment activation gate.
--
-- Ported/adapted from the parallel tarragon-control build of this same spec, which built M4
-- before this repo did.

begin;

do $$
declare
  v_patient_id uuid;
  v_device_id uuid;
  v_validation device_validation;
begin
  insert into patients (date_of_birth, sex_at_birth) values ('1985-01-01', 'male') returning id into v_patient_id;

  -- Rule 1: is_wrist = true -> always wrist_advisory, regardless of make/model/age.
  insert into devices (patient_id, device_kind, make, model, is_wrist)
    values (v_patient_id, 'bp', 'Any Make', 'Any Model', true)
    returning id, validation into v_device_id, v_validation;
  if v_validation <> 'wrist_advisory' then
    raise exception 'M4 DEVICE VALIDATION FAILED: wrist device got %, expected wrist_advisory', v_validation;
  end if;
  raise notice 'M4 (wrist device -> wrist_advisory) PASSED';

  -- Rule 2: make/model absent from validated_devices -> unvalidated_advisory.
  insert into devices (patient_id, device_kind, make, model)
    values (v_patient_id, 'bp', 'Unlisted Make', 'Unlisted Model')
    returning validation into v_validation;
  if v_validation <> 'unvalidated_advisory' then
    raise exception 'M4 DEVICE VALIDATION FAILED: unlisted device got %, expected unvalidated_advisory', v_validation;
  end if;
  raise notice 'M4 (unlisted device -> unvalidated_advisory) PASSED';

  -- Rule 3: on the validated list but approx_age_years > 4 -> unvalidated_advisory.
  insert into validated_devices (make, model, device_kind) values ('Listed Make', 'Listed Model', 'bp');
  insert into devices (patient_id, device_kind, make, model, approx_age_years)
    values (v_patient_id, 'bp', 'Listed Make', 'Listed Model', 5)
    returning validation into v_validation;
  if v_validation <> 'unvalidated_advisory' then
    raise exception 'M4 DEVICE VALIDATION FAILED: 5-year-old listed device got %, expected unvalidated_advisory', v_validation;
  end if;
  raise notice 'M4 (listed device, age > 4 years -> unvalidated_advisory) PASSED';

  -- Correct case: on the list, age <= 4 (or unknown) -> validated.
  insert into devices (patient_id, device_kind, make, model, approx_age_years)
    values (v_patient_id, 'bp', 'Listed Make', 'Listed Model', 2)
    returning validation into v_validation;
  if v_validation <> 'validated' then
    raise exception 'M4 DEVICE VALIDATION FAILED: listed device, 2 years old, got %, expected validated', v_validation;
  end if;
  raise notice 'M4 (listed device, age <= 4 -> validated) PASSED';

  -- An UPDATE that doesn't touch any determining column (e.g. a clinician stamping
  -- validated_by/validated_at after manual review) must not silently recompute validation.
  update devices set validated_by = null, validated_at = now() where id = v_device_id;
  select validation into v_validation from devices where id = v_device_id;
  if v_validation <> 'wrist_advisory' then
    raise exception 'M4 DEVICE VALIDATION FAILED: an unrelated column update clobbered validation (got %, expected unchanged wrist_advisory)', v_validation;
  end if;
  raise notice 'M4 (unrelated column update does not reclassify) PASSED';
end $$;

-- ============================= enrolment device-capture gate =============================
do $$
declare
  v_patient_id uuid;
  v_org_id uuid;
  v_gate_fired boolean;
begin
  insert into organisations (name, contact_email) values ('M4 Test Employer', 'hr@m4test.example.com') returning id into v_org_id;

  -- Zero devices at all -> activation blocked outright.
  insert into patients (date_of_birth, sex_at_birth) values ('1992-01-01', 'female') returning id into v_patient_id;
  v_gate_fired := false;
  begin
    insert into enrolments (patient_id, programme_code, organisation_id, status, started_at)
      values (v_patient_id, 'control', v_org_id, 'active', now());
  exception when others then
    if sqlerrm like 'M4:%' then v_gate_fired := true; else raise; end if;
  end;
  if not v_gate_fired then raise exception 'M4 ENROLMENT GATE FAILED: activated with zero captured devices'; end if;
  raise notice 'M4 (enrolment blocked with zero captured devices) PASSED';

  -- A BP cuff with no arm_circumference_cm -> activation blocked.
  insert into patients (date_of_birth, sex_at_birth) values ('1992-01-01', 'female') returning id into v_patient_id;
  insert into devices (patient_id, device_kind, make, model) values (v_patient_id, 'bp', 'Some Make', 'Some Model');
  v_gate_fired := false;
  begin
    insert into enrolments (patient_id, programme_code, organisation_id, status, started_at)
      values (v_patient_id, 'control', v_org_id, 'active', now());
  exception when others then
    if sqlerrm like 'M4:%' then v_gate_fired := true; else raise; end if;
  end;
  if not v_gate_fired then raise exception 'M4 ENROLMENT GATE FAILED: activated with a BP cuff missing arm_circumference_cm'; end if;
  raise notice 'M4 (enrolment blocked -- BP cuff missing arm_circumference_cm) PASSED';

  -- Complete capture -> activation succeeds.
  insert into patients (date_of_birth, sex_at_birth) values ('1992-01-01', 'female') returning id into v_patient_id;
  insert into devices (patient_id, device_kind, make, model, arm_circumference_cm)
    values (v_patient_id, 'bp', 'Some Make', 'Some Model', 26.5);
  insert into enrolments (patient_id, programme_code, organisation_id, status, started_at)
    values (v_patient_id, 'control', v_org_id, 'active', now());
  raise notice 'M4 (enrolment activates with a complete device capture) PASSED';
end $$;

do $$ begin raise notice '=== M4 SUITE COMPLETE: all assertions passed ==='; end $$;

rollback;
