-- Tarragon Health — Men's Health Platform (CLAUDE.md §45.8): testicular
-- symptom pathway.
--
-- §45.8 asks that "a patient reporting a potentially urgent testicular
-- symptom should be directed into the appropriate urgent clinical pathway."
-- Rather than a new table/trigger, this reuses the existing patient-authored
-- symptoms table and its private.handle_symptom_red_flag() red-flag trigger
-- (20260714120000_symptom_tracking.sql, extended for named red flags by
-- 20260810003553_symptom_types_from_documented_red_flags.sql) exactly the
-- way chest_pain/severe_headache/visual_disturbance/confusion were added —
-- same mechanism, same severity slider, same plan-gated
-- clinician_alerts/self-care-suggestion split (packages/db/tests already
-- cover that split generically, not per symptom_type).
--
-- Two new symptom_type values, two different treatments:
--   * testicular_pain — sudden, severe testicular pain is the classic
--     presentation of testicular torsion, a time-critical surgical
--     emergency. Added to the low-threshold red-flag bucket (severity >= 6,
--     same bucket as chest_pain) so a high-severity report reaches Priority-1
--     clinician escalation without needing the general severity >= 8 floor.
--   * testicular_lump — a new lump/swelling is the testicular-cancer-relevant
--     presentation (see the already-shipped 'men-testicular-self-exam'
--     health-education article), but is not itself a same-day surgical
--     emergency the way acute pain is — left at the general severity
--     thresholds (>=8 red flag, >=5 clinician review), same treatment as
--     'swelling'/'pain' elsewhere on this table.
--
-- Function body is otherwise byte-for-byte identical to the live definition
-- confirmed in 20260812003903_bp_red_flag_vital_type_scope_and_sla_reconcile.sql.

alter type public.symptom_type add value if not exists 'testicular_pain';
alter type public.symptom_type add value if not exists 'testicular_lump';

-- Re-point the low-threshold bucket to include testicular_pain, same
-- severity>=6 rule already applied to breathlessness/chest_pain/etc. Body
-- otherwise byte-for-byte identical to the live function (confirmed against
-- 20260812003903_bp_red_flag_vital_type_scope_and_sla_reconcile.sql).
create or replace function private.handle_symptom_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low_threshold_types public.symptom_type[] := array[
    'breathlessness', 'palpitations', 'swelling',
    'chest_pain', 'severe_headache', 'visual_disturbance', 'confusion',
    'testicular_pain'
  ];
  v_is_red_flag boolean;
  v_has_escalation_access boolean;
begin
  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
  );
  new.is_red_flag := v_is_red_flag;

  if v_is_red_flag then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');
    if v_has_escalation_access then
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
        now() + (private.escalation_sla_minutes('symptom_red_flag', 'urgent_escalation') * interval '1 minute')
      );
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, replace(new.symptom_type::text, '_', ' '), 'Needs prompt attention',
        format('You reported %s at a high severity. This is described in our emergency guidance as needing prompt in-person care — please go to the nearest hospital if it does not settle quickly.', new.symptom_type)
      );
    end if;
  elsif new.severity >= 5 then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');
    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at)
      values (
        new.organisation_id,
        new.patient_id,
        'clinician_review',
        'open',
        format('Symptom check: %s', new.symptom_type),
        format('Patient reported %s at severity %s/10.%s',
               new.symptom_type, new.severity,
               case when new.description is not null then ' Note: ' || new.description else '' end),
        now() + (private.escalation_sla_minutes('symptom_red_flag', 'clinician_review') * interval '1 minute')
      );
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, replace(new.symptom_type::text, '_', ' '), 'Review needed',
        format('You reported %s at a moderate severity. Keep an eye on it and note if it changes; if it persists beyond a day or two, or gets worse, please seek in-person care.', new.symptom_type)
      );
    end if;
  end if;

  return new;
end;
$$;

-- Assertions -- the migration is the test.
do $$
declare
  v_enum_count int;
begin
  select count(*) into v_enum_count
  from pg_enum where enumtypid = 'public.symptom_type'::regtype
    and enumlabel in ('testicular_pain', 'testicular_lump');
  if v_enum_count <> 2 then
    raise exception 'expected 2 new symptom_type values, found %', v_enum_count;
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'handle_symptom_red_flag' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.handle_symptom_red_flag was not created';
  end if;
end $$;
