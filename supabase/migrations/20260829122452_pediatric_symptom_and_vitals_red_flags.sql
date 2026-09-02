-- Tarragon Health — Paediatric symptom triage red flags
-- (Child Health Platform §48.8/§48.9: "Paediatric triage must not simply
-- reuse adult rules" / "dedicated red-flag protocols")
--
-- Four new symptom_type values a parent can log for a young child (poor
-- feeding, lethargy, grunting/retractions, dehydration signs — IMCI-
-- recognised danger signs with no honest adult-symptom equivalent),
-- escalating at a lower severity bar than the adult low-threshold bucket for
-- a patient under 5. Adult thresholds for every existing symptom type are
-- UNCHANGED.
--
-- NOTE on reconciliation (2026-09-02): private.handle_symptom_red_flag has
-- materially evolved since this branch was authored (2026-08-29) — the
-- 2026-08-10 Free-tier correction (CLAUDE.md: "Tarragon Free consumes no
-- doctor time") gated escalation behind private.patient_has_feature_access,
-- added an AI-suggestion fallback (private.raise_dangerous_reading_ai_
-- suggestion) for patients without that access, and switched the emergency
-- path from an emergency_events insert to a gated clinician_alerts insert
-- with private.escalation_sla_minutes-derived SLAs. The branch's original
-- migration would have clobbered all of that with a stale, pre-2026-08-10
-- version of the function (no feature gating, no AI fallback, an
-- emergency_events insert that no longer matches the live pattern). What
-- ships below is the CURRENT live function definition with only the
-- paediatric v_paediatric_types branch added to v_is_red_flag — nothing else
-- about live severity/escalation/gating/paging behaviour changes.
--
-- ALSO DEFERRED (2026-09-02): this branch originally added a second,
-- independent vitals_readings trigger (private.handle_paediatric_fever_red_
-- flag) applying WHO IMCI age-banded fever thresholds. A general, already-
-- wired private.handle_temperature_reading_red_flag trigger (via private.
-- classify_temperature_level) now exists live on the same table/vital_type,
-- with its own feature-gating, escalation dedup, clinician paging and audit
-- logging — none of which IMCI age-awareness was designed against. Adding a
-- second, uncoordinated trigger on the same insert would double-fire (two
-- independent alerts/pages per reading) and bypass the paid-plan gate the
-- live trigger now enforces. Folding IMCI's neonate/infant-specific
-- thresholds into private.classify_temperature_level (or otherwise giving
-- the live trigger age-awareness) is the right shape, but is a clinical-
-- engineering decision for a human to make, not something to guess at while
-- reconciling a merge — left for a deliberate follow-up. Today, a neonate/
-- infant fever still gets the live trigger's adult-threshold protection
-- (>=39C red, >=40C/<35C emergency); it does not yet get IMCI's more
-- sensitive <29-day/29-90-day bands. See docs/PEDIATRIC_CHILD_HEALTH_SPEC.md.

-- ---------------------------------------------------------------------------
-- 1. New symptom_type values for danger signs with no adult equivalent
-- ---------------------------------------------------------------------------
alter type public.symptom_type add value if not exists 'poor_feeding';
alter type public.symptom_type add value if not exists 'lethargy';
alter type public.symptom_type add value if not exists 'grunting_or_retractions';
alter type public.symptom_type add value if not exists 'dehydration_signs';

-- ---------------------------------------------------------------------------
-- 2. Age-aware symptom red-flag trigger (rebased onto the current live
--    function — see this file's header note)
-- ---------------------------------------------------------------------------
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
  v_has_escalation_access boolean;
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
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'handle_symptom_red_flag'
      and pg_get_functiondef(p.oid) like '%v_paediatric_types%'
  ) then
    raise exception 'handle_symptom_red_flag is missing the paediatric red-flag branch';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'handle_symptom_red_flag'
      and pg_get_functiondef(p.oid) like '%patient_has_feature_access%'
  ) then
    raise exception 'handle_symptom_red_flag must keep the live Free-tier escalation gate (patient_has_feature_access)';
  end if;
end $$;
