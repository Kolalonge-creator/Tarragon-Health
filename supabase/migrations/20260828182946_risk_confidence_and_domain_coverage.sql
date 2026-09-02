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

create type public.risk_confidence as enum ('low', 'moderate', 'high');

comment on type public.risk_confidence is
  'How much of the data a risk tier depends on was actually available. '
  'Independent of risk_level/tier — see docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md '
  '"Risk & Prevention Engine" entry. A tier of unknown should, in practice, '
  'always carry confidence=low; nothing enforces that pairing structurally '
  'because a forced-high tier from a confirmed diagnosis is legitimately '
  'high-confidence despite the rest of the questionnaire being incomplete.';

-- ---------------------------------------------------------------------------
-- 2. prevention_risk_scores: confidence + model provenance.
--
-- computed_at already serves as "calculation date"; model_name/model_version
-- are new. Historical rows predate versioned scoring config (this migration
-- ships alongside the risk_questionnaire_configs table, see migration 3/7) —
-- backfilled to the engine that actually produced them
-- (lib/rules/risk-scoring.ts's hardcoded CONDITION_RULES) rather than left
-- null, since we know exactly what computed every existing row. confidence
-- is left null on backfill: we cannot honestly reconstruct how complete the
-- input data was for a historical computation, and a fabricated 'high'
-- would defeat the point of the field.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 3. Risk domain coverage (spec §2.3) — CKD, respiratory, mental wellbeing
-- had no representation at all in prevention_risk_scores.condition. Additive
-- enum values only; no existing row's condition value changes. New values
-- ship UNSIGNED (see risk_questionnaire_configs draft v2 in migration 3/7) —
-- adding the enum member is a schema change, not a clinical decision, but
-- actually SCORING these domains for a patient is, and requires Clinical
-- Director sign-off before it goes active (same split as
-- 20260810033858_preventive_programmes_protocol_governance.sql: cataloguing
-- is free, activating is gated).
-- ---------------------------------------------------------------------------

alter type public.prevention_condition add value 'ckd';
alter type public.prevention_condition add value 'asthma_copd';
alter type public.prevention_condition add value 'mental_wellbeing';

-- ---------------------------------------------------------------------------
-- 4. screen_types.category — a category grouping for the new preventive-care
-- completion view (spec §2.9/§2.12: "My Preventive Care", a checklist by
-- category rather than the existing single Health Score — see migration
-- 4/7). Nullable free grouping, not a hard requirement: an uncategorised
-- screen_type still schedules/reminds/escalates exactly as it does today,
-- it just surfaces under an "Other preventive care" bucket in the new view
-- instead of a named one. Best-effort backfill by name; anything not
-- confidently matched is left null rather than guessed.
-- ---------------------------------------------------------------------------

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
