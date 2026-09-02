-- Healthy Ageing & Elderly Care — comprehensive ageing assessment (spec §50.3).
--
-- One header row per assessment episode (an annual-review-style check-in, not
-- a diagnosis) plus one child row per domain covered. Deliberately does NOT
-- carry cardiovascular, diabetes, or medication domains: those already have a
-- real, live source of truth (care_plans/patient_conditions for the first two,
-- medications + the medication safety panel for the third) and duplicating
-- them here would create exactly the parallel-record problem CLAUDE.md warns
-- against elsewhere (wearable_readings vs vitals_readings). The app composes
-- those three alongside the domains stored here into one comprehensive view;
-- this table only owns the domains with no existing home: mobility, falls,
-- cognition, nutrition, vision, hearing, social support, functional
-- independence, and frailty.
--
-- SAFE LANGUAGE, ENFORCED BY SHAPE NOT CONVENTION: outcome is a closed enum
-- with no diagnostic values. There is no 'dementia', no 'frail', no
-- 'depressed' — only whether a domain looks fine, is worth watching, or is
-- worth a real clinical look. The app is responsible for turning
-- 'further_assessment_suggested' into "your responses suggest that further
-- assessment may be appropriate," never into a label, but the enum itself
-- makes the wrong kind of value impossible to store.
--
-- ACTING-FOR: a caregiver with a 'manage' grant (see
-- 20260801110000_acting_for_someone_you_support.sql,
-- 20260801120000_supporter_can_report_and_assess.sql) can complete this on
-- behalf of the person they support — this is squarely the eldercare
-- caregiver scenario those migrations were built for. logged_by_profile_id
-- names the reporter when it isn't the patient, stamped server-side, never
-- client-supplied.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ageing_assessment_type') then
    create type public.ageing_assessment_type as enum ('self_report', 'clinician');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ageing_assessment_status') then
    create type public.ageing_assessment_status as enum ('in_progress', 'completed');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ageing_assessment_domain') then
    create type public.ageing_assessment_domain as enum (
      'mobility', 'falls', 'cognition', 'nutrition', 'vision', 'hearing',
      'social_support', 'functional_independence', 'frailty'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ageing_assessment_outcome') then
    create type public.ageing_assessment_outcome as enum (
      'no_concern', 'monitor', 'further_assessment_suggested'
    );
  end if;
end $$;

create table if not exists public.ageing_assessments (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  assessment_type       public.ageing_assessment_type not null default 'self_report',
  status                public.ageing_assessment_status not null default 'in_progress',
  logged_by_profile_id  uuid references public.profiles (id) on delete set null,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  completed_by          uuid references public.profiles (id) on delete set null,
  next_review_due_at    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.ageing_assessments.logged_by_profile_id is
  'Who actually filled this in, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid() by stamp_acting_supporter, never client-supplied.';

create index if not exists ageing_assessments_patient_idx
  on public.ageing_assessments (patient_id, started_at desc);
create index if not exists ageing_assessments_org_idx
  on public.ageing_assessments (organisation_id);
create index if not exists ageing_assessments_next_review_idx
  on public.ageing_assessments (next_review_due_at)
  where next_review_due_at is not null;

drop trigger if exists ageing_assessments_set_updated_at on public.ageing_assessments;
create trigger ageing_assessments_set_updated_at
  before update on public.ageing_assessments
  for each row execute function private.set_updated_at();

drop trigger if exists stamp_acting_supporter on public.ageing_assessments;
create trigger stamp_acting_supporter
  before insert on public.ageing_assessments
  for each row execute function private.stamp_acting_supporter('patient_id');

create table if not exists public.ageing_assessment_domain_results (
  id                     uuid primary key default gen_random_uuid(),
  assessment_id          uuid not null references public.ageing_assessments (id) on delete cascade,
  domain                 public.ageing_assessment_domain not null,
  outcome                public.ageing_assessment_outcome not null default 'no_concern',
  -- Raw structured answers to whatever question set the app used for this
  -- domain at the time — shape is app-owned, not schema-owned, since the
  -- question sets will iterate long before this table does.
  responses              jsonb not null default '{}'::jsonb,
  notes                  text,
  clinician_reviewed_by  uuid references public.profiles (id) on delete set null,
  clinician_reviewed_at  timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (assessment_id, domain)
);

create index if not exists ageing_assessment_domain_results_assessment_idx
  on public.ageing_assessment_domain_results (assessment_id);
create index if not exists ageing_assessment_domain_results_review_idx
  on public.ageing_assessment_domain_results (outcome)
  where outcome = 'further_assessment_suggested' and clinician_reviewed_at is null;

drop trigger if exists ageing_assessment_domain_results_set_updated_at
  on public.ageing_assessment_domain_results;
create trigger ageing_assessment_domain_results_set_updated_at
  before update on public.ageing_assessment_domain_results
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ageing_assessments enable row level security;
alter table public.ageing_assessment_domain_results enable row level security;

drop policy if exists ageing_assessments_select on public.ageing_assessments;
create policy ageing_assessments_select on public.ageing_assessments
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

-- Patient or an authorised caregiver may start one. Clinical staff may also
-- start a clinician-conducted assessment.
drop policy if exists ageing_assessments_insert on public.ageing_assessments;
create policy ageing_assessments_insert on public.ageing_assessments
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
    or private.is_org_staff(organisation_id)
  );

-- Only while still in progress and only by whoever is filling it in, or org
-- staff completing/annotating a clinician assessment. Once completed, the
-- header is immutable from the app's perspective — a fresh assessment is the
-- next episode, not an edit to this one.
drop policy if exists ageing_assessments_update on public.ageing_assessments;
create policy ageing_assessments_update on public.ageing_assessments
  for update using (
    (
      status = 'in_progress'
      and (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
    )
    or private.is_org_staff(organisation_id)
  );

drop policy if exists ageing_assessment_domain_results_select on public.ageing_assessment_domain_results;
create policy ageing_assessment_domain_results_select on public.ageing_assessment_domain_results
  for select using (
    exists (
      select 1 from public.ageing_assessments a
      where a.id = ageing_assessment_domain_results.assessment_id
        and (a.patient_id = (select auth.uid()) or private.is_org_staff(a.organisation_id))
    )
  );

drop policy if exists ageing_assessment_domain_results_insert on public.ageing_assessment_domain_results;
create policy ageing_assessment_domain_results_insert on public.ageing_assessment_domain_results
  for insert to authenticated
  with check (
    exists (
      select 1 from public.ageing_assessments a
      where a.id = ageing_assessment_domain_results.assessment_id
        and (
          (a.status = 'in_progress' and (a.patient_id = (select auth.uid()) or private.can_act_for(a.patient_id)))
          or private.is_org_staff(a.organisation_id)
        )
    )
  );

-- A patient/caregiver may revise their own answers while the header is still
-- in progress; once a clinician has reviewed a domain, only org staff may
-- touch it — the patient revising an answer after clinical review has looked
-- at it would silently invalidate that review.
drop policy if exists ageing_assessment_domain_results_update on public.ageing_assessment_domain_results;
create policy ageing_assessment_domain_results_update on public.ageing_assessment_domain_results
  for update using (
    (
      clinician_reviewed_at is null
      and exists (
        select 1 from public.ageing_assessments a
        where a.id = ageing_assessment_domain_results.assessment_id
          and a.status = 'in_progress'
          and (a.patient_id = (select auth.uid()) or private.can_act_for(a.patient_id))
      )
    )
    or exists (
      select 1 from public.ageing_assessments a
      where a.id = ageing_assessment_domain_results.assessment_id
        and private.is_org_staff(a.organisation_id)
    )
  );

grant select, insert, update on public.ageing_assessments to authenticated;
grant select, insert, update on public.ageing_assessment_domain_results to authenticated;
revoke all on public.ageing_assessments from anon;
revoke all on public.ageing_assessment_domain_results from anon;

-- ===========================================================================
-- Proof, not hope.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ageing_assessments'
      and column_name = 'logged_by_profile_id'
  ) then
    raise exception 'ageing_assessments.logged_by_profile_id missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ageing_assessment_domain_results_assessment_id_domain_key'
  ) then
    raise exception 'ageing_assessment_domain_results is missing its (assessment_id, domain) uniqueness guarantee';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ageing_assessments' and policyname = 'ageing_assessments_select'
  ) then
    raise exception 'ageing_assessments RLS select policy missing';
  end if;
end $$;
