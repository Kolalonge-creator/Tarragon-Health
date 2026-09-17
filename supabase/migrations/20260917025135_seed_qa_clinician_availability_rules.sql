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
--
-- These 3 profiles were created directly against the live project (Admin
-- API, no committed migration ever created them -- the whole @tarragon.test
-- QA roster works this way) rather than by seed.sql, so a fresh environment
-- replaying only committed migrations -- a CI run, a fresh local
-- `supabase db reset`, a brand-new project -- genuinely has no such
-- `profiles` row to satisfy provider_availability_rules_clinician_id_fkey
-- against. First failure mode found live, 2026-09-17: the CI migration-
-- replay job rejected this migration outright with a foreign key violation
-- for exactly that reason. Every insert below is guarded on the target
-- profile actually existing, so this is a real seed on the live project and
-- a clean, harmless no-op everywhere else.
do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_tier2 constant uuid := '097527fc-0089-4a5a-93f4-c6fac14d0c56'; -- clinician.tier2.test, medical_officer
  v_tier4 constant uuid := '76374bcb-deb4-4c72-9445-407059b6212a'; -- doctor.tier4.test, senior_medical_officer
  v_cmo   constant uuid := 'e5490d5c-07fa-45c9-8568-26af3c4235d2'; -- doctor.cmo.test, chief_medical_officer
  v_types constant public.appointment_type[] := array['telemedicine', 'result_interpretation']::public.appointment_type[];
begin
  -- Dr. Tier Two Test (medical_officer, employed) -- Mon/Wed/Fri mornings.
  if exists (select 1 from public.profiles where id = v_tier2)
     and not exists (select 1 from public.provider_availability_rules where clinician_id = v_tier2)
  then
    insert into public.provider_availability_rules
      (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
    select v_org, v_tier2, d, time '09:00', time '12:00', 'telemedicine', v_types, 30, 5
    from unnest(array[1, 3, 5]) as d; -- Mon, Wed, Fri
  end if;

  -- Dr. Tier Four Director Test (senior_medical_officer, contracted) -- Tue/Thu mornings.
  if exists (select 1 from public.profiles where id = v_tier4)
     and not exists (select 1 from public.provider_availability_rules where clinician_id = v_tier4)
  then
    insert into public.provider_availability_rules
      (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
    select v_org, v_tier4, d, time '09:00', time '13:00', 'telemedicine', v_types, 30, 5
    from unnest(array[2, 4]) as d; -- Tue, Thu
  end if;

  -- Dr. Chief Medical Officer Test (chief_medical_officer, employed) -- Mon/Wed afternoons.
  if exists (select 1 from public.profiles where id = v_cmo)
     and not exists (select 1 from public.provider_availability_rules where clinician_id = v_cmo)
  then
    insert into public.provider_availability_rules
      (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
    select v_org, v_cmo, d, time '14:00', time '17:00', 'telemedicine', v_types, 30, 5
    from unnest(array[1, 3]) as d; -- Mon, Wed
  end if;

  if not exists (select 1 from public.profiles where id in (v_tier2, v_tier4, v_cmo)) then
    raise notice 'None of the 3 QA clinician profiles exist in this environment -- nothing seeded, this is expected outside the live project.';
  end if;
end $$;

-- get_available_appointment_slots() is SECURITY DEFINER but still gates on
-- private.current_org_id()/private.is_org_staff(), both JWT-claim-based --
-- there is no authenticated session inside a migration to satisfy that
-- check, so the self-check here stays at the rule-row level; the RPC's own
-- output was verified separately, live, as an authenticated patient
-- (patient.complete.test successfully held a real Thu 17 Sept 10:00 slot
-- with Dr. Tier Four Director Test end-to-end, then cancelled it).
--
-- Only asserts for a clinician whose profile actually exists here -- a
-- fresh environment with none of the 3 profiles correctly seeds nothing and
-- must not fail this check over that.
do $$
declare
  v_tier2 constant uuid := '097527fc-0089-4a5a-93f4-c6fac14d0c56';
  v_tier4 constant uuid := '76374bcb-deb4-4c72-9445-407059b6212a';
  v_cmo   constant uuid := 'e5490d5c-07fa-45c9-8568-26af3c4235d2';
  v_expected_clinicians uuid[];
  v_rule_count int;
begin
  select array_agg(id) into v_expected_clinicians
  from public.profiles
  where id in (v_tier2, v_tier4, v_cmo);

  if v_expected_clinicians is null then
    raise notice 'OK: no QA clinician profiles in this environment, nothing to check.';
    return;
  end if;

  select count(*) into v_rule_count
  from public.provider_availability_rules
  where clinician_id = any(v_expected_clinicians) and is_active;
  if v_rule_count = 0 then
    raise exception 'FAIL: % QA clinician profile(s) exist here but provider_availability_rules has zero active rows for them', array_length(v_expected_clinicians, 1);
  end if;
  raise notice 'OK: % active provider_availability_rules rows seeded for % QA clinician(s) present in this environment', v_rule_count, array_length(v_expected_clinicians, 1);
end $$;
