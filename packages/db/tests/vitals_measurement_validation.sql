-- Tarragon Health — vitals measurement provenance & validation verification
--
-- Proves (1) a duplicate reading within 2 minutes is flagged
-- duplicate_entry, (2) a reading far from the patient's own recent average
-- is flagged sudden_change, (3) a BP reading with no position/arm is
-- flagged insufficient_context, (4) an ordinary reading in a stable series
-- stays 'valid', and (5) clear_vitals_validation_flag actually clears a flag
-- and records who cleared it.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_staff_profile uuid;
  v_staff_id uuid;
  v_reading record;
  v_reading_id uuid;
  i integer;
begin
  select organisation_id, id into v_org, v_patient
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  select id, profile_id into v_staff_id, v_staff_profile
  from public.clinical_staff where organisation_id = v_org and profile_id is not null limit 1;

  -- 1) Duplicate entry: two identical BP readings 30 seconds apart.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'blood_pressure', 118, 76, 'seated', 'left', now(), 'manual');

  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'blood_pressure', 118, 76, 'seated', 'left', now() + interval '30 seconds', 'manual')
  returning * into v_reading;

  if v_reading.validation_status <> 'requires_validation' or not ('duplicate_entry' = any(v_reading.validation_flags)) then
    raise exception 'FAIL: identical BP reading 30s later was not flagged duplicate_entry (status=%, flags=%)',
      v_reading.validation_status, v_reading.validation_flags;
  end if;
  raise notice 'PASS 1: duplicate_entry flagged';

  -- 2) Sudden change: build a stable weight history, then log a wildly
  --    different reading — needs >= 3 prior VALID readings to fire at all.
  for i in 1..4 loop
    insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
    values (gen_random_uuid(), v_org, v_patient, 'weight', 80 + i * 0.1, now() - (10 - i) * interval '1 day', 'manual');
  end loop;

  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'weight', 120, now(), 'manual')
  returning * into v_reading;

  if v_reading.validation_status <> 'requires_validation' or not ('sudden_change' = any(v_reading.validation_flags)) then
    raise exception 'FAIL: weight jump from ~80kg to 120kg was not flagged sudden_change (status=%, flags=%)',
      v_reading.validation_status, v_reading.validation_flags;
  end if;
  raise notice 'PASS 2: sudden_change flagged';

  -- 3) Insufficient context: BP reading with neither position nor arm.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'blood_pressure', 122, 78, now() + interval '10 minutes', 'manual')
  returning * into v_reading;

  if v_reading.validation_status <> 'requires_validation' or not ('insufficient_context' = any(v_reading.validation_flags)) then
    raise exception 'FAIL: BP reading with no position/arm was not flagged insufficient_context (status=%, flags=%)',
      v_reading.validation_status, v_reading.validation_flags;
  end if;
  raise notice 'PASS 3: insufficient_context flagged';

  -- 4) An ordinary, well-contextualised, non-duplicate reading stays valid.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'blood_pressure', 121, 79, 'seated', 'right', now() + interval '20 minutes', 'manual')
  returning * into v_reading;

  if v_reading.validation_status <> 'valid' or array_length(v_reading.validation_flags, 1) is not null then
    raise exception 'FAIL: a clean, contextualised reading was unexpectedly flagged (status=%, flags=%)',
      v_reading.validation_status, v_reading.validation_flags;
  end if;
  raise notice 'PASS 4: ordinary reading stays valid';

  -- 5) clear_vitals_validation_flag clears the flag from check (1) and
  --    records who cleared it, when called by staff in the patient's org.
  select id into v_reading_id
  from public.vitals_readings
  where patient_id = v_patient and vital_type = 'blood_pressure' and 'duplicate_entry' = any(validation_flags)
  limit 1;

  if v_staff_profile is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    perform public.clear_vitals_validation_flag(v_reading_id);

    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    select * into v_reading from public.vitals_readings where id = v_reading_id;
    if v_reading.validation_status <> 'valid' or v_reading.validated_by is null or v_reading.validated_at is null then
      raise exception 'FAIL: clear_vitals_validation_flag did not clear the flag / record reviewer (status=%, validated_by=%, validated_at=%)',
        v_reading.validation_status, v_reading.validated_by, v_reading.validated_at;
    end if;
    raise notice 'PASS 5: clear_vitals_validation_flag clears the flag and records the reviewer';
  else
    raise notice 'SKIP 5: no clinical_staff row with a profile_id in this seed to act as reviewer';
  end if;

  raise notice 'ALL VITALS_MEASUREMENT_VALIDATION CHECKS PASSED';
end $$;

rollback;
