-- Tarragon Health — Patient onboarding, Phase C
-- care_plan_recommendations: the "recommended care programme" output of the
-- risk assessment.
--
-- This is a *suggestion* surfaced to the patient, NOT a clinician-signed care
-- plan (docs/CLINICAL_TRUST_MODEL_SPEC.md — never claim doctor review without
-- a real record). care_plans stays clinician-authored (its insert RLS requires
-- org staff, unchanged). A recommendation is generated server-side from the
-- risk engine and a clinician later *promotes* it into a real care_plans row;
-- until then it renders as "pending your care team's review".
--
-- Write path mirrors prevention_risk_scores: the patient never inserts these
-- (the rows are the server's own computation), so there is no patient INSERT
-- policy — submitRiskAssessment writes them via the service-role client.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'care_plan_recommendation_status') then
    create type public.care_plan_recommendation_status as enum (
      'proposed', 'accepted', 'dismissed'
    );
  end if;
end;
$$;

create table if not exists public.care_plan_recommendations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  condition        public.care_plan_condition not null,
  tier             public.risk_level not null default 'moderate',
  rationale        text not null,
  inputs_snapshot  jsonb not null default '{}'::jsonb,
  status           public.care_plan_recommendation_status not null default 'proposed',
  -- Set when a clinician promotes the recommendation into a real plan.
  care_plan_id     uuid references public.care_plans (id) on delete set null,
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists care_plan_recommendations_patient_idx
  on public.care_plan_recommendations (patient_id);
create index if not exists care_plan_recommendations_org_idx
  on public.care_plan_recommendations (organisation_id);

-- At most one open (proposed) recommendation per patient+condition, so
-- retaking the assessment doesn't pile up duplicates.
create unique index if not exists care_plan_recommendations_one_open
  on public.care_plan_recommendations (patient_id, condition)
  where status = 'proposed';

create trigger care_plan_recommendations_set_updated_at
  before update on public.care_plan_recommendations
  for each row execute function private.set_updated_at();

alter table public.care_plan_recommendations enable row level security;

-- Patient reads own; org staff read. No patient write (server-role generated).
drop policy if exists care_plan_recommendations_select on public.care_plan_recommendations;
create policy care_plan_recommendations_select on public.care_plan_recommendations
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Only org staff may act on a recommendation (accept / dismiss).
drop policy if exists care_plan_recommendations_staff_update on public.care_plan_recommendations;
create policy care_plan_recommendations_staff_update on public.care_plan_recommendations
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.care_plan_recommendations to authenticated;
