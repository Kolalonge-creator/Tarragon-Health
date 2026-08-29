-- Tarragon Health — Paediatric symptom triage + emergency red flags
-- (Child Health Platform §48.8/§48.9: "Paediatric triage must not simply
-- reuse adult rules" / "dedicated red-flag protocols")
--
-- Two additive engines, both age-aware via profiles.date_of_birth, both
-- reusing the existing emergency_events/clinician_alerts machinery rather
-- than inventing a parallel one (same reasoning as the BP/symptom engines
-- this migration sits alongside):
--
--   1. Four new symptom_type values a parent can log for a young child
--      (poor feeding, lethargy, grunting/retractions, dehydration signs —
--      IMCI-recognised danger signs with no honest adult-symptom
--      equivalent), escalating at a lower severity bar than the adult
--      low-threshold bucket for a patient under 5. Adult thresholds for
--      every existing symptom type are UNCHANGED.
--   2. A temperature-reading trigger on vitals_readings applying WHO IMCI's
--      well-established age-banded fever thresholds (a neonate's fever
--      workup is categorically different from an adult's — treating it as
--      just "temperature >= 39" would under-triage a genuine emergency).
--      Only acts when the patient's age is known and under 5; every other
--      vitals_readings insert is untouched.

-- ---------------------------------------------------------------------------
-- 1. New symptom_type values for danger signs with no adult equivalent
-- ---------------------------------------------------------------------------
alter type public.symptom_type add value if not exists 'poor_feeding';
alter type public.symptom_type add value if not exists 'lethargy';
alter type public.symptom_type add value if not exists 'grunting_or_retractions';
alter type public.symptom_type add value if not exists 'dehydration_signs';

-- ---------------------------------------------------------------------------
-- 2. Age-aware symptom red-flag trigger
-- ---------------------------------------------------------------------------
-- Byte-for-byte identical to 20260810003553's adult logic EXCEPT the new
-- v_paediatric_types branch, which only ever applies to a patient under 5
-- with a known date_of_birth — an unknown DOB or age >= 5 falls straight
-- through to the exact same adult rule this replaces.
create or replace function private.handle_symptom_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low_threshold_types public.symptom_type[] := array[
    'breathlessness', 'palpitations', 'swelling',
    'chest_pain', 'severe_headache', 'visual_disturbance', 'confusion'
  ];
  v_paediatric_types public.symptom_type[] := array[
    'poor_feeding', 'lethargy', 'grunting_or_retractions', 'dehydration_signs'
  ];
  v_dob date;
  v_age_years integer;
  v_is_red_flag boolean;
begin
  select date_of_birth into v_dob from public.profiles where id = new.patient_id;
  if v_dob is not null then
    v_age_years := extract(year from age(new.reported_at::date, v_dob));
  end if;

  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
    -- Paediatric danger signs escalate at a materially lower bar: in a child
    -- under 5, lethargy or poor feeding at even moderate severity is not the
    -- same clinical picture as an adult reporting mild fatigue.
    or (v_age_years is not null and v_age_years < 5
        and new.symptom_type = any (v_paediatric_types) and new.severity >= 4)
  );
  new.is_red_flag := v_is_red_flag;

  if v_is_red_flag then
    insert into public.emergency_events
      (organisation_id, patient_id, source, trigger_detail, status)
    values (
      new.organisation_id,
      new.patient_id,
      'symptom_log',
      format('Patient reported %s at severity %s/10.%s',
             new.symptom_type, new.severity,
             case when new.description is not null then ' Note: ' || new.description else '' end),
      'active'
    );
  elsif new.severity >= 5 then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      format('Symptom check: %s', new.symptom_type),
      format('Patient reported %s at severity %s/10.%s',
             new.symptom_type, new.severity,
             case when new.description is not null then ' Note: ' || new.description else '' end)
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Paediatric fever red-flag engine (vitals_readings, temperature_c)
-- ---------------------------------------------------------------------------
-- WHO IMCI (Integrated Management of Childhood Illness) age bands — well-
-- established public guidance, not a precision-sensitive statistic:
--   < 29 days (neonate):  any fever >= 38.0C OR hypothermia < 36.0C -> EMERGENCY
--   29 days - 3 months:   fever >= 38.0C -> EMERGENCY (sepsis-workup age band)
--   3 months - 5 years:   fever >= 39.0C -> urgent clinician review
-- Mirrors private.handle_bp_reading_red_flag's shape exactly: EMERGENCY hands
-- off to emergency_events (which raises the Priority-1 alert itself); the
-- lower band raises a clinician_alerts row directly. A patient/dependent with
-- no known DOB, or aged 5+, is untouched — falls through with no alert from
-- this trigger (existing engines for that vital_type, if any, are unaffected).
alter type public.emergency_source add value if not exists 'paediatric_fever';

create or replace function private.handle_paediatric_fever_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dob date;
  v_age_days integer;
  v_detail text;
begin
  if new.vital_type <> 'temperature' or new.temperature_c is null then
    return new;
  end if;

  select date_of_birth into v_dob from public.profiles where id = new.patient_id;
  if v_dob is null then
    return new;
  end if;
  v_age_days := new.taken_at::date - v_dob;
  if v_age_days < 0 or v_age_days >= (5 * 365) then
    return new;
  end if;

  v_detail := format('Temperature %s C logged %s (age %s days).',
                     new.temperature_c, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'), v_age_days);

  if v_age_days < 29 and (new.temperature_c >= 38.0 or new.temperature_c < 36.0) then
    insert into public.emergency_events
      (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
    values (new.organisation_id, new.patient_id, 'paediatric_fever',
            'Neonate (under 29 days) with fever or low temperature. ' || v_detail, 'active', new.id);
    return new;
  end if;

  if v_age_days < 90 and new.temperature_c >= 38.0 then
    insert into public.emergency_events
      (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
    values (new.organisation_id, new.patient_id, 'paediatric_fever',
            'Infant under 3 months with fever. ' || v_detail, 'active', new.id);
    return new;
  end if;

  if new.temperature_c >= 39.0 then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at)
    values (
      new.organisation_id, new.patient_id, 'urgent_escalation', 'open',
      'High fever in a young child', v_detail, now() + interval '4 hours'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists vitals_readings_paediatric_fever_flag on public.vitals_readings;
create trigger vitals_readings_paediatric_fever_flag
  after insert on public.vitals_readings
  for each row execute function private.handle_paediatric_fever_red_flag();

-- Assertions.
do $$
declare v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array['poor_feeding','lethargy','grunting_or_retractions','dehydration_signs']) t
  where not exists (
    select 1 from pg_enum where enumtypid = 'public.symptom_type'::regtype and enumlabel = t
  );
  if v_missing is not null then
    raise exception 'symptom_type missing expected paediatric values: %', v_missing;
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'vitals_readings_paediatric_fever_flag'
  ) then
    raise exception 'paediatric fever red-flag trigger was not created';
  end if;
end $$;
