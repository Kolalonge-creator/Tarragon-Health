-- Healthy Ageing & Elderly Care — falls-risk pathway (spec §50.4).
--
-- RENAMED from 20260829121803_falls_risk_pathway.sql (2026-09-02) -- same
-- collision, same fix, same source PR (#322) as
-- 20260902180527_ageing_assessments_caregiver_access.sql: this collided on
-- version `20260829121803` with
-- 20260829121803_20260829121500_falls_risk_pathway.sql, an earlier,
-- differently-named migration for the same feature. Confirmed against the
-- live koiplnmbgnqnbywhpjlf project that only the other file's version is
-- actually applied in production -- this one never landed live, so
-- renaming it here is a pure git-history fix. Content untouched: every
-- create is `if not exists` or preceded by its own `drop ... if exists`,
-- so it still applies cleanly on top of the original migration and layers
-- in its one real addition -- `private.can_act_for(patient_id)` on the RLS
-- policies, so a caregiver acting for a patient can flag/read that
-- patient's falls-risk records too.
--
-- A dedicated table rather than folding into ageing_assessment_domain_results:
-- unlike the other new domains, falls risk has its own real multi-stage
-- clinical pathway (Risk identified -> Clinical assessment -> Intervention ->
-- Follow-up), not just a single outcome. The stage progression is clinical
-- work, not self-report, so only org staff may move it forward — a patient or
-- caregiver can flag risk factors (which is how the pathway starts), never
-- assess, intervene, or resolve it themselves.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'falls_risk_pathway_stage') then
    create type public.falls_risk_pathway_stage as enum (
      'risk_identified', 'clinical_assessment', 'intervention', 'follow_up', 'resolved'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'falls_risk_level') then
    create type public.falls_risk_level as enum ('low', 'moderate', 'high');
  end if;
end $$;

create table if not exists public.falls_risk_assessments (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  ageing_assessment_id    uuid references public.ageing_assessments (id) on delete set null,
  logged_by_profile_id    uuid references public.profiles (id) on delete set null,

  -- Contributing factors captured at identification (spec §50.4).
  previous_falls_12mo     boolean not null default false,
  mobility_impairment     boolean not null default false,
  high_risk_medications   boolean not null default false,
  environmental_hazards   boolean not null default false,
  balance_concern         boolean not null default false,

  -- Defaulted from the factor count below, clinician may override at
  -- clinical assessment — that override is a plain UPDATE, not a new column.
  risk_level              public.falls_risk_level,
  pathway_stage           public.falls_risk_pathway_stage not null default 'risk_identified',

  identified_at           timestamptz not null default now(),
  assessed_by             uuid references public.profiles (id) on delete set null,
  assessed_at             timestamptz,
  intervention_notes      text,
  intervention_started_at timestamptz,
  follow_up_due_at        timestamptz,
  follow_up_completed_at  timestamptz,
  resolved_at             timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on column public.falls_risk_assessments.logged_by_profile_id is
  'Who flagged this, when that is not the patient. NULL = the patient themselves. Server-derived, never client-supplied.';

create index if not exists falls_risk_assessments_patient_idx
  on public.falls_risk_assessments (patient_id, identified_at desc);
create index if not exists falls_risk_assessments_org_idx
  on public.falls_risk_assessments (organisation_id);
create index if not exists falls_risk_assessments_open_idx
  on public.falls_risk_assessments (organisation_id, pathway_stage)
  where pathway_stage <> 'resolved';

drop trigger if exists falls_risk_assessments_set_updated_at on public.falls_risk_assessments;
create trigger falls_risk_assessments_set_updated_at
  before update on public.falls_risk_assessments
  for each row execute function private.set_updated_at();

drop trigger if exists stamp_acting_supporter on public.falls_risk_assessments;
create trigger stamp_acting_supporter
  before insert on public.falls_risk_assessments
  for each row execute function private.stamp_acting_supporter('patient_id');

-- Default risk_level from the contributing-factor count when the caller
-- didn't set one (the normal patient/caregiver self-flag path). A clinician
-- can still write an explicit value straight through, e.g. a clinician-led
-- screen that already knows the level.
create or replace function private.default_falls_risk_level()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_factor_count int;
begin
  if new.risk_level is null then
    v_factor_count :=
      (new.previous_falls_12mo)::int + (new.mobility_impairment)::int +
      (new.high_risk_medications)::int + (new.environmental_hazards)::int +
      (new.balance_concern)::int;
    new.risk_level := case
      when v_factor_count >= 3 then 'high'
      when v_factor_count = 2 then 'moderate'
      else 'low'
    end::public.falls_risk_level;
  end if;
  return new;
end;
$$;

drop trigger if exists falls_risk_assessments_default_level on public.falls_risk_assessments;
create trigger falls_risk_assessments_default_level
  before insert on public.falls_risk_assessments
  for each row execute function private.default_falls_risk_level();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.falls_risk_assessments enable row level security;

-- Includes can_act_for so a caregiver can read back what they just flagged
-- (also required for INSERT ... RETURNING to work for them at all: Postgres
-- checks the new row against the SELECT policy for RETURNING to succeed).
drop policy if exists falls_risk_assessments_select on public.falls_risk_assessments;
create policy falls_risk_assessments_select on public.falls_risk_assessments
  for select using (
    patient_id = (select auth.uid())
    or private.can_act_for(patient_id)
    or private.is_org_staff(organisation_id)
  );

-- Patient/caregiver may only ever create the pathway at its start. Org staff
-- may also insert directly (a clinician-initiated screen).
drop policy if exists falls_risk_assessments_insert on public.falls_risk_assessments;
create policy falls_risk_assessments_insert on public.falls_risk_assessments
  for insert to authenticated
  with check (
    (
      (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
      and pathway_stage = 'risk_identified'
    )
    or private.is_org_staff(organisation_id)
  );

-- Progressing the pathway (clinical assessment, intervention, follow-up,
-- resolution) is clinical work: org staff only, never the patient/caregiver
-- who raised it.
drop policy if exists falls_risk_assessments_update on public.falls_risk_assessments;
create policy falls_risk_assessments_update on public.falls_risk_assessments
  for update using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.falls_risk_assessments to authenticated;
revoke all on public.falls_risk_assessments from anon;

-- ===========================================================================
-- Proof, not hope.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'falls_risk_assessments'
      and policyname = 'falls_risk_assessments_update'
  ) then
    raise exception 'falls_risk_assessments update policy missing';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'falls_risk_assessments'
      and policyname = 'falls_risk_assessments_update'
      and qual ilike '%patient_id%'
  ) then
    raise exception 'falls_risk_assessments update policy must not allow the patient to self-progress the pathway';
  end if;
end $$;
