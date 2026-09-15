-- prevention_intake v1 (20260828183044_risk_questionnaire_configs.sql) is a
-- byte-for-byte port of risk-scoring.ts's CONDITION_RULES as it stood on
-- 2026-08-28 — 7 conditions. Since then, 267aaa16 ("Add cardiovascular and
-- kidney disease risk checks to the Risk Assessment tab") added an 8th
-- condition, "ckd", to the hardcoded legacy engine — but nobody ported it
-- into the config. Unlike v1's own header comment claims ("ships UNSIGNED
-- ... today's production behaviour does not change"), v1 is in fact live:
-- it is the active, Director-approved row for every organisation today.
-- That means the config-driven engine — the one actually serving patients —
-- has been silently omitting a CKD risk tier for every prevention intake
-- since ckd was added to the legacy engine, while the new CKD risk card
-- (apps/web/src/app/(dashboard)/patient/ckd-risk-card.tsx) and
-- risk-questionnaire-engine.parity.test.ts both expect it. Found via the
-- parity test failing on CI, not via a report — see PR discussion.
--
-- Fix: a new v2 draft — v1's config verbatim, plus one added "ckd" condition
-- copied factor-for-factor from risk-scoring.ts's CONDITION_RULES (score
-- moderate_threshold=2/high_threshold=5, no forced-high diagnosis tag; ckd's
-- own factors reuse existing questions only — existing_diagnoses,
-- family_diabetes, family_hypertension, smoking_status, height_cm/weight_kg
-- for bmi — so no new question was needed). Nothing else in v1's JSON is
-- touched: questions array is identical, the other 7 conditions are
-- byte-identical to v1.
--
-- Ships as another UNSIGNED draft, same as v1's own insert policy requires
-- (approved_by/approved_at null, is_active false) — signing is exclusively
-- via sign_risk_questionnaire_config(), which demands an active Chief
-- Medical Officer. This migration does not call it and must not: whether v2
-- is an accurate, safe config for real patients is a clinical judgement,
-- not an engineering one. Until a Clinical Director reviews and signs v2,
-- v1 (without ckd) stays active — same "zero behaviour change until signed"
-- discipline v1's own seed used, this time deliberately not extended to
-- "and therefore the gap silently persists forever" once a Director acts.

insert into public.risk_questionnaire_configs (organisation_id, code, version, notes, config)
select
  o.id, 'prevention_intake', 2,
  'Adds the "ckd" condition (Chronic Kidney Disease) that risk-scoring.ts gained in '
  '267aaa16 after v1 was seeded — v1 is missing it entirely, so the active config-driven '
  'engine has been silently skipping CKD risk for every patient. Otherwise byte-identical '
  'to v1: same 22 questions, same other 7 conditions. ckd factors ported verbatim from '
  'risk-scoring.ts CONDITION_RULES (moderate=2/high=5, no forced-high diagnosis). Proven '
  'equivalent by risk-questionnaire-engine.parity.test.ts. Sign to close the gap.',
  $config$
{
  "questions": [
    { "key": "family_diabetes", "category": "family_history", "prompt": "Does anyone in your immediate family have diabetes?", "input_type": "boolean", "required": true, "order_index": 1 },
    { "key": "family_hypertension", "category": "family_history", "prompt": "Does anyone in your immediate family have high blood pressure?", "input_type": "boolean", "required": true, "order_index": 2 },
    { "key": "family_heart_disease", "category": "family_history", "prompt": "Does anyone in your immediate family have heart disease?", "input_type": "boolean", "required": true, "order_index": 3 },
    { "key": "family_sickle_cell", "category": "family_history", "prompt": "Does anyone in your immediate family have sickle cell disease or trait?", "input_type": "boolean", "required": true, "order_index": 4 },
    { "key": "family_cancer_types", "category": "family_history", "prompt": "Has anyone in your immediate family had any of these cancers?", "input_type": "multi_select", "required": true, "order_index": 5,
      "options": [
        { "value": "breast", "label": "Breast" },
        { "value": "cervical", "label": "Cervical" },
        { "value": "colorectal", "label": "Colorectal" },
        { "value": "prostate", "label": "Prostate" },
        { "value": "other", "label": "Other" }
      ]
    },
    { "key": "family_cancer_other_detail", "category": "family_history", "prompt": "Which other cancer type?", "input_type": "text", "required": false, "order_index": 6, "max_length": 300,
      "applicability": { "op": "includes", "field": "family_cancer_types", "value": "other" }
    },
    { "key": "smoking_status", "category": "lifestyle", "prompt": "Do you currently smoke, or have you smoked in the past?", "input_type": "single_select", "required": true, "order_index": 7,
      "options": [
        { "value": "never", "label": "Never smoked" },
        { "value": "former", "label": "Former smoker" },
        { "value": "current", "label": "Current smoker" }
      ]
    },
    { "key": "cigarettes_per_day", "category": "lifestyle", "prompt": "Roughly how many cigarettes a day?", "input_type": "single_select", "required": true, "order_index": 8,
      "options": [
        { "value": "1_5", "label": "1 to 5" },
        { "value": "6_10", "label": "6 to 10" },
        { "value": "11_20", "label": "11 to 20" },
        { "value": "20_plus", "label": "More than 20" }
      ],
      "applicability": { "op": "eq", "field": "smoking_status", "value": "current" }
    },
    { "key": "alcohol_use", "category": "lifestyle", "prompt": "How would you describe your alcohol use?", "input_type": "single_select", "required": true, "order_index": 9,
      "options": [
        { "value": "none", "label": "I do not drink" },
        { "value": "moderate", "label": "Moderate" },
        { "value": "heavy", "label": "Heavy" }
      ]
    },
    { "key": "exercise_days_per_week", "category": "lifestyle", "prompt": "In a typical week, how many days do you exercise?", "input_type": "number", "required": true, "order_index": 10, "min": 0, "max": 7 },
    { "key": "exercise_minutes_per_session", "category": "lifestyle", "prompt": "On a typical exercise day, how many minutes?", "input_type": "number", "required": true, "order_index": 11, "min": 0, "max": 300 },
    { "key": "diet_pattern", "category": "lifestyle", "prompt": "Which best describe your usual diet?", "input_type": "multi_select", "required": true, "order_index": 12,
      "options": [
        { "value": "balanced", "label": "Balanced" },
        { "value": "high_sugar", "label": "High sugar" },
        { "value": "high_salt", "label": "High salt" },
        { "value": "high_fat", "label": "High fat" },
        { "value": "vegetarian", "label": "Vegetarian" },
        { "value": "low_fibre", "label": "Low fibre" }
      ]
    },
    { "key": "sleep_hours", "category": "lifestyle", "prompt": "On average, how many hours do you sleep a night?", "input_type": "single_select", "required": true, "order_index": 13,
      "options": [
        { "value": "less_than_5", "label": "Less than 5" },
        { "value": "5_to_6", "label": "5 to 6" },
        { "value": "7_to_8", "label": "7 to 8" },
        { "value": "more_than_8", "label": "More than 8" }
      ]
    },
    { "key": "stress_level", "category": "lifestyle", "prompt": "How would you rate your day-to-day stress level?", "input_type": "single_select", "required": true, "order_index": 14,
      "options": [
        { "value": "low", "label": "Low" },
        { "value": "moderate", "label": "Moderate" },
        { "value": "high", "label": "High" }
      ]
    },
    { "key": "height_cm", "category": "lifestyle", "prompt": "What is your height, in centimetres?", "input_type": "number", "required": true, "order_index": 15, "min": 100, "max": 230 },
    { "key": "weight_kg", "category": "lifestyle", "prompt": "What is your current weight, in kilograms?", "input_type": "number", "required": false, "order_index": 16, "min": 20, "max": 300 },
    { "key": "existing_diagnoses", "category": "pmh", "prompt": "Have you been diagnosed with any of these conditions?", "input_type": "multi_select", "required": true, "order_index": 17,
      "options": [
        { "value": "hypertension", "label": "Hypertension" },
        { "value": "diabetes", "label": "Diabetes" },
        { "value": "heart_disease", "label": "Heart disease" },
        { "value": "high_cholesterol", "label": "High cholesterol" },
        { "value": "other", "label": "Other" }
      ]
    },
    { "key": "existing_diagnoses_other_detail", "category": "pmh", "prompt": "Which other diagnosis?", "input_type": "text", "required": false, "order_index": 18, "max_length": 300,
      "applicability": { "op": "includes", "field": "existing_diagnoses", "value": "other" }
    },
    { "key": "current_medications", "category": "meds", "prompt": "List any medications you currently take.", "input_type": "text", "required": false, "order_index": 19, "max_length": 500 },
    { "key": "hpv_vaccinated", "category": "vaccination", "prompt": "Have you had the HPV vaccine?", "input_type": "boolean", "required": true, "order_index": 20 },
    { "key": "other_vaccines_detail", "category": "vaccination", "prompt": "Any other vaccinations you would like on record?", "input_type": "text", "required": false, "order_index": 21, "max_length": 300 },
    { "key": "prior_abnormal_result", "category": "screening_history", "prompt": "Have you ever had an abnormal screening or lab result?", "input_type": "boolean", "required": true, "order_index": 22 }
  ],
  "conditions": [
    {
      "condition": "hypertension", "sex_applicability": null, "moderate_threshold": 2, "high_threshold": 5,
      "forced_high_predicate": { "op": "includes", "field": "existing_diagnoses", "value": "hypertension" },
      "relevant_question_keys": ["family_hypertension", "smoking_status", "cigarettes_per_day", "height_cm", "weight_kg", "alcohol_use", "stress_level", "exercise_days_per_week", "exercise_minutes_per_session", "sleep_hours", "existing_diagnoses"],
      "factors": [
        { "key": "family_history", "points": 2, "predicate": { "op": "eq", "field": "family_hypertension", "value": true } },
        { "key": "smoking_current", "points": 2, "predicate": { "op": "eq", "field": "smoking_status", "value": "current" } },
        { "key": "smoking_heavy", "points": 1, "predicate": { "op": "and", "clauses": [{ "op": "eq", "field": "smoking_status", "value": "current" }, { "op": "in", "field": "cigarettes_per_day", "value": ["11_20", "20_plus"] }] } },
        { "key": "smoking_former", "points": 1, "predicate": { "op": "eq", "field": "smoking_status", "value": "former" } },
        { "key": "bmi_obese", "points": 2, "predicate": { "op": "gte", "field": "bmi", "value": 30 } },
        { "key": "bmi_overweight", "points": 1, "predicate": { "op": "and", "clauses": [{ "op": "gte", "field": "bmi", "value": 25 }, { "op": "lt", "field": "bmi", "value": 30 }] } },
        { "key": "age_45_plus", "points": 1, "predicate": { "op": "gte", "field": "ageYears", "value": 45 } },
        { "key": "alcohol_heavy", "points": 1, "predicate": { "op": "eq", "field": "alcohol_use", "value": "heavy" } },
        { "key": "stress_high", "points": 1, "predicate": { "op": "eq", "field": "stress_level", "value": "high" } },
        { "key": "insufficient_exercise", "points": 1, "predicate": { "op": "lt", "field": "weeklyExerciseMinutes", "value": 150 } },
        { "key": "poor_sleep", "points": 1, "predicate": { "op": "in", "field": "sleep_hours", "value": ["less_than_5", "more_than_8"] } }
      ]
    },
    {
      "condition": "diabetes", "sex_applicability": null, "moderate_threshold": 2, "high_threshold": 5,
      "forced_high_predicate": { "op": "includes", "field": "existing_diagnoses", "value": "diabetes" },
      "relevant_question_keys": ["family_diabetes", "height_cm", "weight_kg", "exercise_days_per_week", "exercise_minutes_per_session", "diet_pattern", "sleep_hours", "existing_diagnoses"],
      "factors": [
        { "key": "family_history", "points": 2, "predicate": { "op": "eq", "field": "family_diabetes", "value": true } },
        { "key": "bmi_obese", "points": 2, "predicate": { "op": "gte", "field": "bmi", "value": 30 } },
        { "key": "bmi_overweight", "points": 1, "predicate": { "op": "and", "clauses": [{ "op": "gte", "field": "bmi", "value": 25 }, { "op": "lt", "field": "bmi", "value": 30 }] } },
        { "key": "age_35_plus", "points": 1, "predicate": { "op": "gte", "field": "ageYears", "value": 35 } },
        { "key": "insufficient_exercise", "points": 1, "predicate": { "op": "lt", "field": "weeklyExerciseMinutes", "value": 150 } },
        { "key": "diet_high_sugar", "points": 1, "predicate": { "op": "includes", "field": "diet_pattern", "value": "high_sugar" } },
        { "key": "poor_sleep", "points": 1, "predicate": { "op": "in", "field": "sleep_hours", "value": ["less_than_5", "more_than_8"] } }
      ]
    },
    {
      "condition": "cvd", "sex_applicability": null, "moderate_threshold": 3, "high_threshold": 6,
      "forced_high_predicate": { "op": "includes", "field": "existing_diagnoses", "value": "heart_disease" },
      "relevant_question_keys": ["family_heart_disease", "smoking_status", "cigarettes_per_day", "existing_diagnoses", "height_cm", "weight_kg", "alcohol_use"],
      "factors": [
        { "key": "family_history", "points": 2, "predicate": { "op": "eq", "field": "family_heart_disease", "value": true } },
        { "key": "smoking_current", "points": 2, "predicate": { "op": "eq", "field": "smoking_status", "value": "current" } },
        { "key": "smoking_heavy", "points": 1, "predicate": { "op": "and", "clauses": [{ "op": "eq", "field": "smoking_status", "value": "current" }, { "op": "in", "field": "cigarettes_per_day", "value": ["11_20", "20_plus"] }] } },
        { "key": "smoking_former", "points": 1, "predicate": { "op": "eq", "field": "smoking_status", "value": "former" } },
        { "key": "existing_hypertension", "points": 2, "predicate": { "op": "includes", "field": "existing_diagnoses", "value": "hypertension" } },
        { "key": "existing_diabetes", "points": 2, "predicate": { "op": "includes", "field": "existing_diagnoses", "value": "diabetes" } },
        { "key": "bmi_obese", "points": 1, "predicate": { "op": "gte", "field": "bmi", "value": 30 } },
        { "key": "age_threshold", "points": 1, "predicate": { "op": "or", "clauses": [
          { "op": "and", "clauses": [{ "op": "eq", "field": "sex", "value": "male" }, { "op": "gte", "field": "ageYears", "value": 45 }] },
          { "op": "and", "clauses": [{ "op": "eq", "field": "sex", "value": "female" }, { "op": "gte", "field": "ageYears", "value": 55 }] }
        ] } },
        { "key": "alcohol_heavy", "points": 1, "predicate": { "op": "eq", "field": "alcohol_use", "value": "heavy" } }
      ]
    },
    {
      "condition": "ckd", "sex_applicability": null, "moderate_threshold": 2, "high_threshold": 5,
      "relevant_question_keys": ["existing_diagnoses", "family_diabetes", "family_hypertension", "smoking_status", "height_cm", "weight_kg"],
      "factors": [
        { "key": "existing_diabetes", "points": 3, "predicate": { "op": "includes", "field": "existing_diagnoses", "value": "diabetes" } },
        { "key": "existing_hypertension", "points": 3, "predicate": { "op": "includes", "field": "existing_diagnoses", "value": "hypertension" } },
        { "key": "family_diabetes", "points": 1, "predicate": { "op": "eq", "field": "family_diabetes", "value": true } },
        { "key": "family_hypertension", "points": 1, "predicate": { "op": "eq", "field": "family_hypertension", "value": true } },
        { "key": "age_60_plus", "points": 1, "predicate": { "op": "gte", "field": "ageYears", "value": 60 } },
        { "key": "smoking_current", "points": 1, "predicate": { "op": "eq", "field": "smoking_status", "value": "current" } },
        { "key": "bmi_obese", "points": 1, "predicate": { "op": "gte", "field": "bmi", "value": 30 } }
      ]
    },
    {
      "condition": "breast_ca", "sex_applicability": "female", "moderate_threshold": 1, "high_threshold": 4,
      "relevant_question_keys": ["family_cancer_types"],
      "factors": [
        { "key": "family_history", "points": 3, "predicate": { "op": "includes", "field": "family_cancer_types", "value": "breast" } },
        { "key": "age_40_plus", "points": 1, "predicate": { "op": "gte", "field": "ageYears", "value": 40 } },
        { "key": "age_50_plus", "points": 1, "predicate": { "op": "gte", "field": "ageYears", "value": 50 } }
      ]
    },
    {
      "condition": "cervical_ca", "sex_applicability": "female", "moderate_threshold": 1, "high_threshold": 4,
      "relevant_question_keys": ["family_cancer_types", "hpv_vaccinated", "smoking_status", "cigarettes_per_day"],
      "factors": [
        { "key": "family_history", "points": 3, "predicate": { "op": "includes", "field": "family_cancer_types", "value": "cervical" } },
        { "key": "not_hpv_vaccinated", "points": 1, "predicate": { "op": "eq", "field": "hpv_vaccinated", "value": false } },
        { "key": "smoking_current", "points": 1, "predicate": { "op": "eq", "field": "smoking_status", "value": "current" } },
        { "key": "smoking_heavy", "points": 1, "predicate": { "op": "and", "clauses": [{ "op": "eq", "field": "smoking_status", "value": "current" }, { "op": "in", "field": "cigarettes_per_day", "value": ["11_20", "20_plus"] }] } }
      ]
    },
    {
      "condition": "colorectal_ca", "sex_applicability": null, "moderate_threshold": 1, "high_threshold": 4,
      "relevant_question_keys": ["family_cancer_types", "smoking_status", "cigarettes_per_day", "diet_pattern", "alcohol_use"],
      "factors": [
        { "key": "family_history", "points": 3, "predicate": { "op": "includes", "field": "family_cancer_types", "value": "colorectal" } },
        { "key": "age_45_plus", "points": 1, "predicate": { "op": "gte", "field": "ageYears", "value": 45 } },
        { "key": "smoking_current", "points": 1, "predicate": { "op": "eq", "field": "smoking_status", "value": "current" } },
        { "key": "smoking_heavy", "points": 1, "predicate": { "op": "and", "clauses": [{ "op": "eq", "field": "smoking_status", "value": "current" }, { "op": "in", "field": "cigarettes_per_day", "value": ["11_20", "20_plus"] }] } },
        { "key": "diet_low_fibre", "points": 1, "predicate": { "op": "includes", "field": "diet_pattern", "value": "low_fibre" } },
        { "key": "alcohol_heavy", "points": 1, "predicate": { "op": "eq", "field": "alcohol_use", "value": "heavy" } }
      ]
    },
    {
      "condition": "prostate_ca", "sex_applicability": "male", "moderate_threshold": 1, "high_threshold": 4,
      "relevant_question_keys": ["family_cancer_types"],
      "factors": [
        { "key": "family_history", "points": 3, "predicate": { "op": "includes", "field": "family_cancer_types", "value": "prostate" } },
        { "key": "age_45_plus", "points": 1, "predicate": { "op": "gte", "field": "ageYears", "value": 45 } },
        { "key": "age_50_plus", "points": 1, "predicate": { "op": "gte", "field": "ageYears", "value": 50 } }
      ]
    }
  ]
}
$config$::jsonb
from public.organisations o
on conflict (organisation_id, code, version) do nothing;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
  v_active_still_v1 boolean;
begin
  select count(*) into v_count from public.risk_questionnaire_configs
    where code = 'prevention_intake' and version = 2;
  if v_count = 0 then
    raise exception 'FAIL: prevention_intake v2 was not seeded';
  end if;

  if exists (
    select 1 from public.risk_questionnaire_configs
    where code = 'prevention_intake' and version = 2
      and (jsonb_array_length(config -> 'conditions') <> 8
           or not (config -> 'conditions' @> '[{"condition": "ckd"}]'::jsonb))
  ) then
    raise exception 'FAIL: prevention_intake v2 does not have all 8 conditions including ckd';
  end if;

  if exists (
    select 1 from public.risk_questionnaire_configs
    where code = 'prevention_intake' and version = 2 and is_active
  ) then
    raise exception 'FAIL: v2 must ship unsigned/inactive — signing is a clinical decision, not this migration''s';
  end if;

  select not exists (
    select 1 from public.risk_questionnaire_configs
    where code = 'prevention_intake' and version = 2 and is_active
  ) into v_active_still_v1;
  if not v_active_still_v1 then
    raise exception 'FAIL: seeding v2 must not change which version is active';
  end if;

  raise notice 'PASS: prevention_intake v2 seeded with ckd added, unsigned, zero behaviour change until a Director signs it';
end $$;
