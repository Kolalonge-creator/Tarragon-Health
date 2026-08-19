-- Tarragon Health
-- Add symptom_type values for red flags already documented in
-- condition_protocols but never selectable in the patient symptom log.
--
-- 20260716223544_condition_protocols.sql's own red_flags text names, per
-- pathway:
--   hypertension: "chest pain, breathlessness, neurological deficit, severe
--     headache, visual disturbance" (symptomatic BP >= 180/110 - emergency)
--   diabetes: "...vomiting or abdominal pain - suspected DKA", "impaired
--     consciousness - emergency", "sudden visual loss"
--   ckd: "uraemic symptoms (nausea, confusion, pericarditis)"
--   heart_failure: "chest pain" (already listed alongside breathlessness)
--
-- breathlessness/palpitations/swelling already exist and already sit in
-- private.handle_symptom_red_flag()'s low-severity-threshold bucket
-- (20260714120000_symptom_tracking.sql). chest_pain, severe_headache and
-- visual_disturbance are named as emergency-level symptoms in the
-- hypertension/diabetes red-flag text above with no matching symptom_type
-- at all today (a patient having one could only log it as generic 'pain'
-- or 'other', at the general severity>=8 threshold, not the lower one this
-- migration gives it). confusion is CKD's and diabetes' hypoglycaemia
-- red flag, also currently unrepresented. Nausea already exists and stays
-- out of the low-threshold bucket -- it is CKD's red flag only in
-- combination with the other uraemic symptoms, not alone, so leaving it at
-- the general severity>=8 threshold is the correct, non-inflated read of
-- the source text.
--
-- Deliberately not adding a "vomiting"/"abdominal pain" or "foot ulcer"
-- type here: those are compound/structured findings (DKA needs vomiting
-- AND abdominal pain AND high glucose together; a foot ulcer is a physical
-- finding, not a self-rated severity) that don't fit this table's
-- single-symptom-plus-severity-slider shape without misrepresenting what a
-- lone severity rating on them would mean. Out of scope for this pass.

alter type public.symptom_type add value 'chest_pain';
alter type public.symptom_type add value 'severe_headache';
alter type public.symptom_type add value 'visual_disturbance';
alter type public.symptom_type add value 'confusion';

-- Re-point the low-threshold bucket at the four new values, same severity>=6
-- rule already applied to breathlessness/palpitations/swelling. Body
-- otherwise byte-for-byte identical to the live function.
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
  v_is_red_flag boolean;
begin
  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
  );
  new.is_red_flag := v_is_red_flag;

  if v_is_red_flag then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at)
    values (
      new.organisation_id,
      new.patient_id,
      'urgent_escalation',
      'open',
      format('Priority 1: red-flag symptom (%s)', new.symptom_type),
      format('Patient reported %s at severity %s/10.%s',
             new.symptom_type, new.severity,
             case when new.description is not null then ' Note: ' || new.description else '' end),
      now() + interval '4 hours'
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

-- Assertions -- the migration is the test.
do $$
declare
  v_enum_count int;
  v_missing text;
begin
  select count(*) into v_enum_count
  from pg_enum where enumtypid = 'public.symptom_type'::regtype
    and enumlabel in ('chest_pain', 'severe_headache', 'visual_disturbance', 'confusion');
  if v_enum_count <> 4 then
    raise exception 'expected 4 new symptom_type values, found %', v_enum_count;
  end if;

  select string_agg(t, ', ') into v_missing
  from unnest(array['pain','fatigue','breathlessness','dizziness','palpitations',
                     'swelling','nausea','other','chest_pain','severe_headache',
                     'visual_disturbance','confusion']) t
  where not exists (
    select 1 from pg_enum where enumtypid = 'public.symptom_type'::regtype and enumlabel = t
  );
  if v_missing is not null then
    raise exception 'symptom_type missing expected values: %', v_missing;
  end if;
end $$;
