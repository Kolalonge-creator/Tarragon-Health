-- M4 exit test (spec §20): "I2 and I3 tests pass; enrolment blocked
-- without a captured device." Run m1_fixture.sql first.

-- Seed one validated-device list entry for the "validated" path (the real
-- list is an open decision per spec §21.4 -- this is a fixture entry, not
-- an authoritative one).
insert into validated_devices (make, model, device_kind)
values ('Omron', 'HEM-7120', 'bp')
on conflict do nothing;

-- Device validation rules.
do $$
declare
  v_wrist_id uuid;
  v_unlisted_id uuid;
  v_validated_id uuid;
  v_old_id uuid;
  v_validation device_validation;
begin
  reset role;

  insert into devices (patient_id, device_kind, make, model, is_wrist, approx_age_years)
  values ('33333333-3333-3333-3333-333333333301', 'bp', 'Omron', 'HEM-7120', true, 1)
  returning id into v_wrist_id;
  select validation into v_validation from devices where id = v_wrist_id;
  if v_validation <> 'wrist_advisory' then raise exception 'FAIL M4: wrist device expected wrist_advisory, got %', v_validation; end if;
  raise notice 'PASS M4a: is_wrist=true is always wrist_advisory';

  insert into devices (patient_id, device_kind, make, model, is_wrist, approx_age_years)
  values ('33333333-3333-3333-3333-333333333301', 'bp', 'GenericBrand', 'XYZ-100', false, 1)
  returning id into v_unlisted_id;
  select validation into v_validation from devices where id = v_unlisted_id;
  if v_validation <> 'unvalidated_advisory' then raise exception 'FAIL M4: unlisted device expected unvalidated_advisory, got %', v_validation; end if;
  raise notice 'PASS M4b: a make/model absent from validated_devices is unvalidated_advisory';

  insert into devices (patient_id, device_kind, make, model, is_wrist, approx_age_years, arm_circumference_cm)
  values ('33333333-3333-3333-3333-333333333301', 'bp', 'Omron', 'HEM-7120', false, 2, 28.0)
  returning id into v_validated_id;
  select validation into v_validation from devices where id = v_validated_id;
  if v_validation <> 'validated' then raise exception 'FAIL M4: listed, non-wrist, <=4yo device expected validated, got %', v_validation; end if;
  raise notice 'PASS M4c: a listed, non-wrist device <=4 years old is validated';

  insert into devices (patient_id, device_kind, make, model, is_wrist, approx_age_years)
  values ('33333333-3333-3333-3333-333333333301', 'bp', 'Omron', 'HEM-7120', false, 5)
  returning id into v_old_id;
  select validation into v_validation from devices where id = v_old_id;
  if v_validation <> 'unvalidated_advisory' then raise exception 'FAIL M4: 5-year-old listed device expected unvalidated_advisory, got %', v_validation; end if;
  raise notice 'PASS M4d: a listed device older than 4 years is unvalidated_advisory';

  -- Manual clinician note-taking update (validated_by/validated_at only)
  -- must not silently recompute/overwrite validation.
  update devices set validated_by = '44444444-4444-4444-4444-444444444401', validated_at = now()
  where id = v_old_id;
  select validation into v_validation from devices where id = v_old_id;
  if v_validation <> 'unvalidated_advisory' then raise exception 'FAIL M4: validation changed on a validated_by/validated_at-only update, got %', v_validation; end if;
  raise notice 'PASS M4e: updating only validated_by/validated_at does not recompute validation';
end $$;

-- Enrolment device-capture gate.
do $$
declare
  v_patient_id uuid;
  v_device_id uuid;
begin
  reset role;

  insert into patients (profile_id, date_of_birth, sex_at_birth)
  values (null, '1988-06-15', 'male')
  returning id into v_patient_id;

  begin
    insert into enrolments (patient_id, programme_code, organisation_id, status, started_at)
    values (v_patient_id, 'control', '22222222-2222-2222-2222-222222222201', 'active', now());
    raise exception 'FAIL M4: enrolment activated with zero devices captured';
  exception
    when others then
      if sqlerrm like '%no captured devices row%' then
        raise notice 'PASS M4f: enrolment activation blocked with zero devices captured (%)', sqlerrm;
      else
        raise;
      end if;
  end;

  insert into devices (patient_id, device_kind, make, model, is_wrist, approx_age_years)
  values (v_patient_id, 'bp', 'Omron', 'HEM-7120', false, 1)
  returning id into v_device_id;

  begin
    insert into enrolments (patient_id, programme_code, organisation_id, status, started_at)
    values (v_patient_id, 'control', '22222222-2222-2222-2222-222222222201', 'active', now());
    raise exception 'FAIL M4: enrolment activated with a BP cuff missing arm_circumference_cm';
  exception
    when others then
      if sqlerrm like '%arm_circumference_cm%' then
        raise notice 'PASS M4g: enrolment activation blocked with BP cuff missing arm_circumference_cm (%)', sqlerrm;
      else
        raise;
      end if;
  end;

  update devices set arm_circumference_cm = 27.5 where id = v_device_id;

  insert into enrolments (patient_id, programme_code, organisation_id, status, started_at)
  values (v_patient_id, 'control', '22222222-2222-2222-2222-222222222201', 'active', now());
  raise notice 'PASS M4h: enrolment activates once device + arm_circumference_cm are captured';
end $$;

-- I2: every reading produces exactly one classification row, forced
-- needs_review (M4's honest scope -- the real engine is M5).
do $$
declare
  v_reading_id uuid;
  v_classification_count int;
  v_classification triage_class;
begin
  reset role;

  insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail)
  values ('33333333-3333-3333-3333-333333333301', 'bp', 118, 76, 'mmHg', now(), 'patient_manual', 'm4-fixture-stable-looking')
  returning id into v_reading_id;

  select count(*), max(classification) into v_classification_count, v_classification
  from triage_classifications where reading_id = v_reading_id;

  if v_classification_count <> 1 then raise exception 'FAIL I2: expected exactly 1 classification row, got %', v_classification_count; end if;
  if v_classification <> 'needs_review' then raise exception 'FAIL M4: expected forced needs_review (no real engine yet), got %', v_classification; end if;
  raise notice 'PASS I2/M4i: a reading, even a stable-looking one, gets exactly one classification row (forced needs_review, honest M4 scope)';

  -- Same guarantee across a small batch, including via the M3 sync path.
  -- sync_screening_readings requires an authenticated staff role internally.
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;
  perform private.sync_screening_readings(
    'c0000000-0000-0000-0000-00000000000a',
    jsonb_build_array(
      jsonb_build_object('temp_ref', 'P1', 'type', 'weight', 'value_numeric', 70, 'unit', 'kg', 'taken_at', now()::text)
    )
  );
  reset role;

  select count(*) into v_classification_count
  from triage_classifications tc
  join readings r on r.id = tc.reading_id
  where r.patient_id = (select patient_id from screening_participants where screening_event_id = 'c0000000-0000-0000-0000-00000000000a' and temp_ref = 'P1')
    and r.type = 'weight';

  if v_classification_count <> 1 then raise exception 'FAIL I2: expected exactly 1 classification row for the synced weight reading, got %', v_classification_count; end if;
  raise notice 'PASS I2/M4j: I2 holds for readings arriving via the M3 sync RPC too, not just direct inserts';
end $$;

-- I3: still holds (already proven in M1; reconfirmed here since M4 is the
-- milestone that names it explicitly in its exit test).
do $$
begin
  begin
    insert into readings (patient_id, type, value_numeric, unit, taken_at, source, source_detail)
    values ('33333333-3333-3333-3333-333333333301', 'weight', 70, 'kg', now(), 'patient_manual', null);
    raise exception 'FAIL I3: reading with null source_detail was NOT rejected';
  exception
    when not_null_violation then
      raise notice 'PASS I3 (reconfirmed at M4): reading with null source_detail correctly rejected';
  end;
end $$;

select 'M4_EXIT_TEST_RESULT' as label, 'PASS' as result;
