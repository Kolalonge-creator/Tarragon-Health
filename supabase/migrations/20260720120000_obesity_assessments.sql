-- ============================================================================
-- Obesity clinical assessment (TH-CP-OB-001 §6, §7) — gap closure.
--
-- The structured, doctor-authored assessment the pathway defines: BMI band +
-- waist/WHtR adiposity confirmation (§6.1/§6.2), the clinical-vs-preclinical
-- decision + Edmonton stage (§4.2/§6.3 — a DOCTOR judgement, nullable until
-- set), secondary-cause screen (§6.4) and complication screen (§6.6/§19).
--
-- Objective fields (bmi, category, waist_risk, whtr) are computed by the pure
-- TS classifier (apps/web/src/lib/obesity/classify.ts) and stored here; the
-- clinical status / EOSS are the doctor's own decision. `assessed_by` is
-- SERVER-STAMPED from the caller's clinical_staff row by a trigger — never
-- client-supplied — so attribution can't be forged (same rule as
-- medication-confirm / annual-review completion).
-- ============================================================================

do $$ begin
  create type public.obesity_bmi_category as enum
    ('underweight','healthy','overweight','obesity_class_i','obesity_class_ii','obesity_class_iii');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.obesity_waist_risk as enum ('normal','raised','high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.obesity_clinical_status as enum ('preclinical','clinical');
exception when duplicate_object then null; end $$;

create table if not exists public.obesity_assessments (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  -- Server-stamped from the caller's clinical_staff row (never trusted from client).
  assessed_by           uuid references public.clinical_staff (id) on delete set null,
  -- Raw measurements.
  height_cm             numeric(5,1) not null check (height_cm > 0 and height_cm < 300),
  weight_kg             numeric(5,1) not null check (weight_kg > 0 and weight_kg < 600),
  waist_cm              numeric(5,1) check (waist_cm > 0 and waist_cm < 300),
  -- Objective classification (computed by the TS classifier).
  bmi                   numeric(4,1) not null check (bmi > 0),
  bmi_category          public.obesity_bmi_category not null,
  waist_risk            public.obesity_waist_risk,
  whtr                  numeric(4,3),
  adiposity_confirmed   boolean,
  -- Doctor's clinical judgement (nullable until decided — software never decides).
  clinical_status       public.obesity_clinical_status,
  eoss_stage            smallint check (eoss_stage between 0 and 4),
  functional_limitation boolean not null default false,
  -- Screens (arrays of keys the doctor recorded as present/suspected).
  complications         jsonb not null default '[]'::jsonb,   -- §6.6/§19
  secondary_causes      jsonb not null default '[]'::jsonb,   -- §6.4
  notes                 text,
  assessed_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists obesity_assessments_patient_idx
  on public.obesity_assessments (patient_id, assessed_at desc);
create index if not exists obesity_assessments_org_idx
  on public.obesity_assessments (organisation_id);

drop trigger if exists obesity_assessments_set_updated_at on public.obesity_assessments;
create trigger obesity_assessments_set_updated_at
  before update on public.obesity_assessments
  for each row execute function private.set_updated_at();

-- --- forge-proof attribution -------------------------------------------------
-- On INSERT/UPDATE, overwrite assessed_by with the caller's own clinical_staff
-- id (resolved from profile_id = auth.uid()). A caller with no clinical_staff
-- row leaves it null (org-staff RLS still gates the write; the app layer keeps
-- non-clinical Care Coordinators out of this action per CLAUDE.md).
create or replace function private.stamp_obesity_assessment_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_staff uuid;
begin
  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = new.organisation_id
    and cs.active
  limit 1;
  new.assessed_by := v_staff;  -- may be null; never trust the client value
  return new;
end;
$$;

drop trigger if exists obesity_assessments_stamp_staff on public.obesity_assessments;
create trigger obesity_assessments_stamp_staff
  before insert or update on public.obesity_assessments
  for each row execute function private.stamp_obesity_assessment_staff();

-- --- RLS ---------------------------------------------------------------------
alter table public.obesity_assessments enable row level security;

-- Patient reads own; org-staff read all in-org.
drop policy if exists obesity_assessments_select on public.obesity_assessments;
create policy obesity_assessments_select on public.obesity_assessments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Write is staff-only — an assessment is a clinical artifact, never patient-authored.
drop policy if exists obesity_assessments_insert on public.obesity_assessments;
create policy obesity_assessments_insert on public.obesity_assessments
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists obesity_assessments_update on public.obesity_assessments;
create policy obesity_assessments_update on public.obesity_assessments
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.obesity_assessments to authenticated;
