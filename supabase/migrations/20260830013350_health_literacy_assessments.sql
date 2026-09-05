-- Tarragon Health — Health Education: health-literacy self-assessment (§79.7)
--
-- "How confident are you managing your condition?" — patient-owned,
-- engagement-only signal. Same guardrail as the existing knowledge-check
-- score (docs/archive/HEALTH_EDUCATION_PATHWAY_SPEC.md §1 locked decision
-- #1): this is NOT a clinical assessment, never touches
-- patient_risk_scores or escalation, and is read only by the education
-- recommendation engine to personalise pacing/content, never by a
-- clinician-facing risk surface.

create table if not exists public.health_literacy_assessments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  -- Nullable condition: a patient can rate general confidence, or
  -- confidence for a specific active condition.
  condition       public.care_plan_condition,
  -- 1 (not confident at all) .. 5 (very confident) — a simple Likert scale,
  -- not a scored/weighted clinical instrument.
  confidence_level smallint not null check (confidence_level between 1 and 5),
  assessed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists health_literacy_assessments_patient_idx
  on public.health_literacy_assessments (patient_id, condition, assessed_at desc);
create index if not exists health_literacy_assessments_org_idx
  on public.health_literacy_assessments (organisation_id);

alter table public.health_literacy_assessments enable row level security;

drop policy if exists health_literacy_assessments_select on public.health_literacy_assessments;
create policy health_literacy_assessments_select on public.health_literacy_assessments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists health_literacy_assessments_insert on public.health_literacy_assessments;
create policy health_literacy_assessments_insert on public.health_literacy_assessments
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

grant select, insert on public.health_literacy_assessments to authenticated;

-- Latest confidence level per (patient, condition) — used by the feed RPC.
create or replace function private.health_education_latest_literacy(p_patient uuid, p_condition public.care_plan_condition)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select confidence_level
  from public.health_literacy_assessments
  where patient_id = p_patient
    and (condition = p_condition or (condition is null and p_condition is not null))
  order by (condition = p_condition) desc, assessed_at desc
  limit 1;
$$;
