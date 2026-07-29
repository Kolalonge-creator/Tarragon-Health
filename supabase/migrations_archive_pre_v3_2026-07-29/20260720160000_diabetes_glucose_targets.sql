-- ===========================================================================
-- Diabetes Clinical Pathway — Sprint D: individualised glycaemic targets (§9)
-- ---------------------------------------------------------------------------
-- §9: "Targets are individualised, not one-size-fits-all." Most adults < 7.0%;
-- younger/low-hypo-risk < 6.5%; elderly/frail/hypo-prone relaxed to < 8.0% to
-- avoid harmful hypos. This records the doctor-set target per patient. It
-- drives the review checklist and the §24 "% at their individual HbA1c target"
-- KPI, and gently relaxes ONLY the amber persistent-high band of the glucose
-- engine for 'relaxed' patients — the emergency / hypo thresholds are NEVER
-- relaxed (safety is fixed).
-- ===========================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'glycaemic_target_category') then
    create type public.glycaemic_target_category as enum ('tight', 'standard', 'relaxed');
  end if;
end $$;

create table if not exists public.patient_glucose_targets (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  -- one active target per patient
  patient_id            uuid not null unique references public.profiles (id) on delete cascade,
  category              public.glycaemic_target_category not null default 'standard',
  hba1c_target_percent  numeric(3, 1),
  fasting_min           numeric(4, 1) not null default 4.4,
  fasting_max           numeric(4, 1) not null default 7.0,
  -- upper post-meal / general glucose the amber "persistent high" band uses.
  upper_target          numeric(4, 1) not null default 10.0,
  set_by                uuid references public.clinical_staff (id) on delete set null,
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists patient_glucose_targets_org_idx
  on public.patient_glucose_targets (organisation_id);

drop trigger if exists patient_glucose_targets_set_updated_at on public.patient_glucose_targets;
create trigger patient_glucose_targets_set_updated_at
  before update on public.patient_glucose_targets
  for each row execute function private.set_updated_at();

alter table public.patient_glucose_targets enable row level security;

-- Patient reads their own target; org clinical staff read all and are the only
-- writers (setting a target is a clinical decision — no patient write).
drop policy if exists patient_glucose_targets_select on public.patient_glucose_targets;
create policy patient_glucose_targets_select on public.patient_glucose_targets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists patient_glucose_targets_insert on public.patient_glucose_targets;
create policy patient_glucose_targets_insert on public.patient_glucose_targets
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists patient_glucose_targets_update on public.patient_glucose_targets;
create policy patient_glucose_targets_update on public.patient_glucose_targets
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.patient_glucose_targets to authenticated;
