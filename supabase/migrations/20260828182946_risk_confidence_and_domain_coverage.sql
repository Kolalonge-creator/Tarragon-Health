-- Tarragon Health — Risk & Prevention Engine enhancement, 2/7
-- Risk confidence, model provenance, wider risk-domain coverage, and a
-- category grouping for the preventive-care completion view.
--
-- Runs after 20260827195909_risk_level_unknown.sql commits, so 'unknown' is
-- safe to reference here.

-- ---------------------------------------------------------------------------
-- 1. Risk confidence (spec §2.7) — separate from the tier itself. A tier of
-- "Moderate" computed from a fully-answered questionnaire and a tier of
-- "Moderate" computed with half the relevant questions unanswered are not
-- the same fact, and collapsing them into one field would hide that.
-- ---------------------------------------------------------------------------

-- Tarragon Health — Risk & Prevention Engine enhancement, 2/7. Committed to
-- git but never actually applied to production. Content byte-identical to
-- the committed 20260827200100_risk_confidence_and_domain_coverage.sql.

create type public.risk_confidence as enum ('low', 'moderate', 'high');

comment on type public.risk_confidence is
  'How much of the data a risk tier depends on was actually available. '
  'Independent of risk_level/tier — see docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md '
  '"Risk & Prevention Engine" entry. A tier of unknown should, in practice, '
  'always carry confidence=low; nothing enforces that pairing structurally '
  'because a forced-high tier from a confirmed diagnosis is legitimately '
  'high-confidence despite the rest of the questionnaire being incomplete.';

alter table public.prevention_risk_scores
  add column if not exists confidence   public.risk_confidence,
  add column if not exists model_name   text,
  add column if not exists model_version text;

update public.prevention_risk_scores
  set model_name = 'rule_based_condition_tiering', model_version = 'legacy_hardcoded_v1'
  where model_name is null;

comment on column public.prevention_risk_scores.confidence is
  'Data completeness behind this tier, not the tier itself. Null only for '
  'rows computed before this column existed (see backfill note above).';
comment on column public.prevention_risk_scores.model_name is
  'Stable identifier of the scoring logic that produced this row, e.g. '
  '"rule_based_condition_tiering" or a risk_questionnaire_configs.code.';
comment on column public.prevention_risk_scores.model_version is
  'For the questionnaire-config-driven engine (migration 3/7), this is '
  '"<config version>" of the active risk_questionnaire_configs row used; '
  'for the legacy hardcoded engine it is a fixed literal.';

alter type public.prevention_condition add value 'ckd';
alter type public.prevention_condition add value 'asthma_copd';
alter type public.prevention_condition add value 'mental_wellbeing';

alter table public.screen_types
  add column if not exists category text
    check (category is null or category in (
      'cardiovascular', 'metabolic', 'kidney', 'respiratory',
      'cancer', 'womens_health', 'mens_health', 'mental_wellbeing',
      'general_health'
    ));

comment on column public.screen_types.category is
  'Groups screen_types for the patient-facing preventive-care completion '
  'view. Purely a display/aggregation grouping — booking, reminders, and '
  'escalation never read this column.';

update public.screen_types set category = 'cardiovascular'
  where category is null and (
    name ilike '%hypertension%' or name ilike '%blood pressure%' or
    name ilike '%ecg%' or name ilike '%cardio%' or name ilike '%lipid%' or
    name ilike '%cholesterol%'
  );

update public.screen_types set category = 'metabolic'
  where category is null and (
    name ilike '%diabetes%' or name ilike '%glucose%' or name ilike '%hba1c%' or
    name ilike '%obesity%' or name ilike '%metabolic%'
  );

update public.screen_types set category = 'cancer'
  where category is null and (
    name ilike '%breast%' or name ilike '%cervical%' or name ilike '%prostate%' or
    name ilike '%colorectal%' or name ilike '%mammogra%' or name ilike '%pap smear%' or
    name ilike '%psa%' or name ilike '%fit test%'
  );

update public.screen_types set category = 'kidney'
  where category is null and (name ilike '%kidney%' or name ilike '%renal%' or name ilike '%egfr%');

update public.screen_types set category = 'respiratory'
  where category is null and (name ilike '%asthma%' or name ilike '%copd%' or name ilike '%lung%' or name ilike '%spirometry%');

update public.screen_types set category = 'mental_wellbeing'
  where category is null and (name ilike '%mental%' or name ilike '%depression%' or name ilike '%anxiety%');

update public.screen_types set category = 'womens_health'
  where category is null and (name ilike '%gyn%' or name ilike '%pregnan%' or name ilike '%pelvic%');

update public.screen_types set category = 'mens_health'
  where category is null and (name ilike '%prostat%' and name not ilike '%psa%');

update public.screen_types set category = 'general_health'
  where category is null and (
    name ilike '%annual health check%' or name ilike '%health_check%' or
    name ilike '%blood group%' or name ilike '%genotype%' or name ilike '%hearing%' or
    name ilike '%dental%' or name ilike '%b12%' or name ilike '%ferritin%' or
    name ilike '%fbc%' or name ilike '%lft%'
  );
