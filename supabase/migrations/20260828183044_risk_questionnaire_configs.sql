-- Tarragon Health — Risk & Prevention Engine enhancement, 3/7. Committed to
-- git but never actually applied to production. Content byte-identical to
-- the committed 20260827200508_risk_questionnaire_configs.sql.

create table public.risk_questionnaire_configs (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  code              text not null,
  version           integer not null,
  config            jsonb not null,
  notes             text,
  approved_by       uuid references public.clinical_staff (id) on delete restrict,
  approved_at       timestamptz,
  is_active         boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint risk_questionnaire_configs_active_requires_signature
    check (not is_active or (approved_by is not null and approved_at is not null)),
  unique (organisation_id, code, version)
);

create unique index risk_questionnaire_configs_one_active
  on public.risk_questionnaire_configs (organisation_id, code) where is_active;
create index risk_questionnaire_configs_org_idx on public.risk_questionnaire_configs (organisation_id);

comment on table public.risk_questionnaire_configs is
  'Versioned, Clinical-Director-signed risk questionnaire + scoring config. '
  'One row per (organisation, code, version); at most one active row per '
  '(organisation, code). config shape: { questions: QuestionnaireQuestionConfig[], '
  'conditions: RiskConditionConfig[] } — see apps/web/src/lib/rules/risk-questionnaire-engine.ts.';

alter table public.risk_questionnaire_configs enable row level security;

create policy risk_questionnaire_configs_select on public.risk_questionnaire_configs
  for select to authenticated
  using (true);

create policy risk_questionnaire_configs_insert on public.risk_questionnaire_configs
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

grant select, insert on public.risk_questionnaire_configs to authenticated;

create or replace function public.sign_risk_questionnaire_config(p_config_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_code text;
  v_staff uuid;
begin
  select organisation_id, code into v_org, v_code
  from public.risk_questionnaire_configs where id = p_config_id;
  if v_org is null then
    raise exception 'Risk questionnaire configuration not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_org
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign a risk questionnaire configuration';
  end if;

  update public.risk_questionnaire_configs set is_active = false
    where organisation_id = v_org and code = v_code and is_active and id <> p_config_id;

  update public.risk_questionnaire_configs
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_config_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values
    (v_org, (select auth.uid()), 'risk_questionnaire_config.signed', 'risk_questionnaire_configs', p_config_id,
     jsonb_build_object('signed_by_clinical_staff', v_staff, 'code', v_code));

  return p_config_id;
end $$;

revoke all on function public.sign_risk_questionnaire_config(uuid) from public;
revoke all on function public.sign_risk_questionnaire_config(uuid) from anon;
grant execute on function public.sign_risk_questionnaire_config(uuid) to authenticated;

insert into public.risk_questionnaire_configs (organisation_id, code, version, notes, config)
select
  o.id, 'prevention_intake', 1,
  'Verbatim port of the pre-existing hardcoded engine (lib/rules/risk-scoring.ts + '
  'lib/validation/risk-assessment.ts) — zero clinical change. Proven equivalent by '
  'risk-questionnaire-engine.parity.test.ts. Sign to let the app switch to reading '
  'this config instead of the hardcoded fallback.',
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

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.risk_questionnaire_configs
    where code = 'prevention_intake' and version = 1;
  if v_count = 0 then
    raise exception 'FAIL: prevention_intake v1 was not seeded';
  end if;

  if exists (select 1 from public.risk_questionnaire_configs where is_active) then
    raise exception 'FAIL: a risk_questionnaire_configs row is active before any Director sign-off';
  end if;

  if exists (
    select 1 from public.risk_questionnaire_configs
    where code = 'prevention_intake' and version = 1
      and jsonb_array_length(config -> 'conditions') <> 7
  ) then
    raise exception 'FAIL: prevention_intake v1 does not have all 7 ported conditions';
  end if;

  begin
    insert into public.risk_questionnaire_configs (organisation_id, code, version, config, is_active)
    select id, '__gate_test__', 999, '{}'::jsonb, true from public.organisations limit 1;
    raise exception 'FAIL: inserting an active config without a signature should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: active-requires-signature constraint holds';
  end;

  raise notice 'PASS: risk_questionnaire_configs installed, prevention_intake v1 seeded as an unsigned draft, zero behaviour change to current scoring';
end $$;
