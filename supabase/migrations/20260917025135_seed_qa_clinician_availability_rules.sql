-- Seeds recurring weekly availability for 3 already-existing @tarragon.test
-- QA fixture clinical_staff accounts (never the founder's own real profile),
-- so the patient-facing appointment booking flow
-- (get_available_appointment_slots(), reading provider_availability_rules)
-- has something to actually return. Confirmed live 2026-09-17: this table
-- had zero rows platform-wide, so no patient could book any video visit or
-- result consultation regardless of plan/entitlement -- the code and RLS
-- were fine, there was simply no clinician-configured availability behind
-- them. This is QA/demo scaffolding, not a claim that any of these three
-- fixture doctors are real, or that this schedule reflects anyone's actual
-- calendar.
--
-- Coverage chosen for spread across the working week, one rule per
-- clinician per day, both patient-bookable appointment types
-- (telemedicine, result_interpretation -- see PATIENT_BOOKABLE_APPOINTMENT_TYPES
-- in appointment-labels.ts), open-ended (effective_until left null).
do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_tier2 constant uuid := '097527fc-0089-4a5a-93f4-c6fac14d0c56'; -- clinician.tier2.test, medical_officer
  v_tier4 constant uuid := '76374bcb-deb4-4c72-9445-407059b6212a'; -- doctor.tier4.test, senior_medical_officer
  v_cmo   constant uuid := 'e5490d5c-07fa-45c9-8568-26af3c4235d2'; -- doctor.cmo.test, chief_medical_officer
  v_types constant public.appointment_type[] := array['telemedicine', 'result_interpretation']::public.appointment_type[];
begin
  -- Guard against re-running this migration (or a future one covering the
  -- same ground) from silently doubling every slot.
  if exists (
    select 1 from public.provider_availability_rules
    where clinician_id in (v_tier2, v_tier4, v_cmo)
  ) then
    raise notice 'QA clinician availability rules already exist -- skipping seed.';
  else
    -- Dr. Tier Two Test (medical_officer, employed) -- Mon/Wed/Fri mornings.
    insert into public.provider_availability_rules
      (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
    select v_org, v_tier2, d, time '09:00', time '12:00', 'telemedicine', v_types, 30, 5
    from unnest(array[1, 3, 5]) as d; -- Mon, Wed, Fri

    -- Dr. Tier Four Director Test (senior_medical_officer, contracted) -- Tue/Thu mornings.
    insert into public.provider_availability_rules
      (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
    select v_org, v_tier4, d, time '09:00', time '13:00', 'telemedicine', v_types, 30, 5
    from unnest(array[2, 4]) as d; -- Tue, Thu

    -- Dr. Chief Medical Officer Test (chief_medical_officer, employed) -- Mon/Wed afternoons.
    insert into public.provider_availability_rules
      (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
    select v_org, v_cmo, d, time '14:00', time '17:00', 'telemedicine', v_types, 30, 5
    from unnest(array[1, 3]) as d; -- Mon, Wed
  end if;
end $$;

-- get_available_appointment_slots() is SECURITY DEFINER but still gates on
-- private.current_org_id()/private.is_org_staff(), both JWT-claim-based --
-- there is no authenticated session inside a migration to satisfy that
-- check, so the self-check here stays at the rule-row level; the RPC's own
-- output was verified separately, live, as an authenticated patient
-- (patient.complete.test successfully held a real Thu 17 Sept 10:00 slot
-- with Dr. Tier Four Director Test end-to-end, then cancelled it).
do $$
declare
  v_tier2 constant uuid := '097527fc-0089-4a5a-93f4-c6fac14d0c56';
  v_tier4 constant uuid := '76374bcb-deb4-4c72-9445-407059b6212a';
  v_cmo   constant uuid := 'e5490d5c-07fa-45c9-8568-26af3c4235d2';
  v_rule_count int;
begin
  select count(*) into v_rule_count
  from public.provider_availability_rules
  where clinician_id in (v_tier2, v_tier4, v_cmo) and is_active;
  if v_rule_count < 7 then
    raise exception 'FAIL: expected at least 7 active provider_availability_rules rows across the 3 seeded QA clinicians, found %', v_rule_count;
  end if;
  raise notice 'OK: % active provider_availability_rules rows seeded for QA clinicians', v_rule_count;
end $$;
