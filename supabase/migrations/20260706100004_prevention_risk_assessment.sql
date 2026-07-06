-- Tarragon Health — V1 consumer spec reconciliation (Phase 0)
-- 04 · Risk assessment questionnaire + rule-based prevention risk tiering
--
-- risk_assessment_responses: the structured questionnaire (family history,
-- lifestyle, PMH/meds, vaccination + screening history, per-question). No
-- unique constraint on (profile_id, question_key) — retaking the assessment
-- keeps prior answers rather than upserting, since a clinical questionnaire's
-- retake history has audit value.
--
-- prevention_risk_scores: rule-based tier per condition, computed from the
-- responses above. Named distinctly from the existing chronic-disease
-- patient_risk_scores (20260705000002_chronic_disease.sql) — that table is
-- ML/rule-based chronic-disease scoring (score_type/score/risk_level), this
-- one is prevention-focused condition tiering fed by the screening
-- recommendation engine. Reuses the existing public.risk_level enum rather
-- than adding a near-duplicate risk_tier type.

create type public.risk_assessment_category as enum (
  'lifestyle', 'family_history', 'pmh', 'meds', 'vaccination', 'screening_history'
);

create type public.prevention_condition as enum (
  'hypertension', 'diabetes', 'cvd', 'breast_ca', 'cervical_ca', 'colorectal_ca',
  'prostate_ca', 'other'
);

create table public.risk_assessment_responses (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  category          public.risk_assessment_category not null,
  question_key      text not null,
  response          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index risk_assessment_responses_profile_idx on public.risk_assessment_responses (profile_id, created_at desc);
create index risk_assessment_responses_org_idx on public.risk_assessment_responses (organisation_id);
create index risk_assessment_responses_category_idx on public.risk_assessment_responses (category);

create table public.prevention_risk_scores (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  condition         public.prevention_condition not null,
  tier              public.risk_level not null default 'low',
  computed_at       timestamptz not null default now(),
  inputs_snapshot   jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index prevention_risk_scores_profile_idx on public.prevention_risk_scores (profile_id, computed_at desc);
create index prevention_risk_scores_org_idx on public.prevention_risk_scores (organisation_id);
create index prevention_risk_scores_condition_idx on public.prevention_risk_scores (condition);

alter table public.risk_assessment_responses enable row level security;
alter table public.prevention_risk_scores    enable row level security;

-- risk_assessment_responses: patient owns their own answers; staff manage org.
create policy risk_assessment_responses_select on public.risk_assessment_responses
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy risk_assessment_responses_insert on public.risk_assessment_responses
  for insert to authenticated
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy risk_assessment_responses_update on public.risk_assessment_responses
  for update to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy risk_assessment_responses_delete on public.risk_assessment_responses
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

-- prevention_risk_scores: system/staff-computed (rules engine is a future
-- server-side job, not modelled here); patient reads own, same as
-- patient_risk_scores' existing visibility pattern.
create policy prevention_risk_scores_select on public.prevention_risk_scores
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy prevention_risk_scores_insert on public.prevention_risk_scores
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy prevention_risk_scores_update on public.prevention_risk_scores
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy prevention_risk_scores_delete on public.prevention_risk_scores
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.risk_assessment_responses to authenticated;
grant select, insert, update, delete on public.prevention_risk_scores to authenticated;
