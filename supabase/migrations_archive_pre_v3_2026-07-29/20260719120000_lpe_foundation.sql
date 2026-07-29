-- ============================================================================
-- Lifestyle Programme Engine (LPE) — Phase 1 foundation schema
-- Spec: guideline/LIFESTYLE_ENGINE_SPEC.md · Plan: docs/LIFESTYLE_ENGINE_BUILD_PLAN.md
--
-- Condition-agnostic template hierarchy + patient instances + the unified
-- lifestyle measurement store. Safety tables (red_flag_event / escalation
-- wiring) land in the Phase 2 migration.
--
-- Conventions: id uuid pk, organisation_id + RLS on every patient table,
-- Africa/Lagos, source enum EXCLUDES 'whatsapp' by design (spec §4.3).
-- Namespaced `lpe_` so it coexists with the retiring `lifestyle_*` tables.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums (idempotent)
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.lpe_module as enum ('diet','activity','behaviour','sleep','stress');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lpe_measurement_type as enum (
    'bp','glucose','weight','waist','bmi_derived','activity_minutes','steps',
    'strength_session','food_log','mood','sleep','ketones','insulin_dose',
    'med_adherence','foot_check','symptom','side_effect');
exception when duplicate_object then null; end $$;

-- Intentionally NO 'whatsapp' — inbound WhatsApp is never an authoritative log.
do $$ begin
  create type public.lpe_measurement_source as enum ('app','web','coordinator','device');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lpe_enrollment_status as enum
    ('draft','active','paused','maintenance','disengaged','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lpe_phase_kind as enum
    ('foundation','build','strengthen','maintenance','continuous');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lpe_phase_status as enum ('pending','active','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lpe_goal_status as enum ('active','achieved','softened','abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lpe_task_status as enum ('pending','done','missed','skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lpe_task_channel as enum ('app','whatsapp_reminder');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Templates — authored, versioned, clinician-reviewed. GLOBAL (no org).
-- ---------------------------------------------------------------------------
create table if not exists public.lpe_programme_templates (
  id            uuid primary key default gen_random_uuid(),
  condition     public.care_plan_condition not null,
  version       integer not null default 1,
  name          text not null,
  active        boolean not null default true,
  modules       jsonb not null default '{}'::jsonb,   -- {diet:{enabled,weight},...}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (condition, version)
);

create table if not exists public.lpe_phase_templates (
  id                   uuid primary key default gen_random_uuid(),
  programme_template_id uuid not null references public.lpe_programme_templates (id) on delete cascade,
  order_index          integer not null,
  key                  text not null,
  name                 text not null,
  kind                 public.lpe_phase_kind not null,
  duration_days_min    integer check (duration_days_min >= 0),
  duration_days_max    integer check (duration_days_max >= 0),
  auto_advance         boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (programme_template_id, key)
);

create table if not exists public.lpe_goal_templates (
  id               uuid primary key default gen_random_uuid(),
  phase_template_id uuid not null references public.lpe_phase_templates (id) on delete cascade,
  module           public.lpe_module not null,
  key              text not null,
  title            text not null,
  description      text,
  metric_key       text,
  target           jsonb,
  cadence          text,
  priority         integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (phase_template_id, key)
);

create table if not exists public.lpe_task_templates (
  id              uuid primary key default gen_random_uuid(),
  goal_template_id uuid not null references public.lpe_goal_templates (id) on delete cascade,
  key             text not null,
  title           text not null,
  instruction     text,
  schedule        jsonb,                       -- cron-like + windows
  channel         public.lpe_task_channel not null default 'app',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (goal_template_id, key)
);

create table if not exists public.lpe_content_blocks (
  id            uuid primary key default gen_random_uuid(),
  condition     public.care_plan_condition,     -- null ⇒ applies to all
  module        public.lpe_module,
  key           text not null unique,
  title         text not null,
  body_md       text not null,
  reading_level text,
  clinician_reviewed boolean not null default false,
  -- pgvector embedding column added in Phase 5 (content personalisation).
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Patient instances
-- ---------------------------------------------------------------------------
create table if not exists public.lpe_enrollments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  condition       public.care_plan_condition not null,
  doctor_id       uuid references public.profiles (id) on delete set null,
  status          public.lpe_enrollment_status not null default 'draft',
  consent_id      uuid,                          -- FK wired with consent in Phase 4
  paused_reason   text,
  started_at      timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (patient_id, condition)
);
create index if not exists lpe_enrollments_patient_idx
  on public.lpe_enrollments (patient_id, status);

create table if not exists public.lpe_programme_instances (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete restrict,
  enrollment_id             uuid not null references public.lpe_enrollments (id) on delete cascade,
  programme_template_id     uuid not null references public.lpe_programme_templates (id) on delete restrict,
  current_phase_instance_id uuid,               -- self-ref set after phases created
  goals_config              jsonb not null default '{}'::jsonb,  -- doctor overrides
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (enrollment_id)
);

create table if not exists public.lpe_phase_instances (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  programme_instance_id uuid not null references public.lpe_programme_instances (id) on delete cascade,
  phase_template_id     uuid not null references public.lpe_phase_templates (id) on delete restrict,
  status                public.lpe_phase_status not null default 'pending',
  started_at            timestamptz,
  target_end_at         timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.lpe_goal_instances (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  programme_instance_id uuid not null references public.lpe_programme_instances (id) on delete cascade,
  goal_template_id      uuid references public.lpe_goal_templates (id) on delete set null,
  module                public.lpe_module not null,
  title                 text not null,
  metric_key            text,
  target                jsonb,
  status                public.lpe_goal_status not null default 'active',
  personalised          boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.lpe_task_instances (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  goal_instance_id uuid not null references public.lpe_goal_instances (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  due_at          timestamptz not null,
  task_window     jsonb,
  status          public.lpe_task_status not null default 'pending',
  completed_at    timestamptz,
  source          public.lpe_measurement_source,  -- who marked it done
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists lpe_task_instances_due_idx
  on public.lpe_task_instances (patient_id, status, due_at);

-- ---------------------------------------------------------------------------
-- Unified measurement store (lifestyle-only signals; overlapping vitals go to
-- vitals_readings with source='device'/'manual' — no dual source of truth).
-- ---------------------------------------------------------------------------
create table if not exists public.lpe_measurements (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  enrollment_id     uuid references public.lpe_enrollments (id) on delete set null,
  type              public.lpe_measurement_type not null,
  value_num         numeric,
  value_json        jsonb,
  unit              text not null,
  context           jsonb,
  taken_at          timestamptz not null,
  source            public.lpe_measurement_source not null,  -- never 'whatsapp'
  validated         boolean not null default true,
  flagged           boolean not null default false,
  red_flag_event_id uuid,                          -- FK wired in Phase 2
  created_at        timestamptz not null default now(),
  check (value_num is not null or value_json is not null)
);
create index if not exists lpe_measurements_patient_idx
  on public.lpe_measurements (patient_id, type, taken_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'lpe_programme_templates','lpe_phase_templates','lpe_goal_templates',
    'lpe_task_templates','lpe_content_blocks','lpe_enrollments',
    'lpe_programme_instances','lpe_phase_instances','lpe_goal_instances',
    'lpe_task_instances'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.lpe_programme_templates enable row level security;
alter table public.lpe_phase_templates     enable row level security;
alter table public.lpe_goal_templates      enable row level security;
alter table public.lpe_task_templates      enable row level security;
alter table public.lpe_content_blocks      enable row level security;
alter table public.lpe_enrollments         enable row level security;
alter table public.lpe_programme_instances enable row level security;
alter table public.lpe_phase_instances     enable row level security;
alter table public.lpe_goal_instances      enable row level security;
alter table public.lpe_task_instances      enable row level security;
alter table public.lpe_measurements        enable row level security;

-- Templates + content: authenticated read (active), admin write.
do $$
declare t text;
begin
  foreach t in array array[
    'lpe_programme_templates','lpe_phase_templates','lpe_goal_templates',
    'lpe_task_templates','lpe_content_blocks'
  ] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format(
      'create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
         using (private.is_admin()) with check (private.is_admin())', t, t);
  end loop;
end $$;

-- Instances + measurements: patient-owner or org-staff (standard pattern).
do $$
declare t text;
begin
  foreach t in array array[
    'lpe_enrollments','lpe_measurements','lpe_task_instances'
  ] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
         with check (
           (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
           or private.is_org_staff(organisation_id))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
         using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
         with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))', t, t);
  end loop;
end $$;

-- Programme/phase/goal instances: no patient_id column — the patient reaches
-- them through THEIR OWN enrollment (row-scoped, not merely same-org); staff via
-- org membership. Write is staff-only (the engine/doctor owns these rows).

-- Programme instances → via enrollment ownership.
drop policy if exists lpe_programme_instances_select on public.lpe_programme_instances;
create policy lpe_programme_instances_select on public.lpe_programme_instances
  for select to authenticated using (
    private.is_org_staff(organisation_id)
    or enrollment_id in (
      select e.id from public.lpe_enrollments e where e.patient_id = (select auth.uid())));
drop policy if exists lpe_programme_instances_write on public.lpe_programme_instances;
create policy lpe_programme_instances_write on public.lpe_programme_instances
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- Phase + goal instances → via their programme instance's enrollment ownership.
do $$
declare t text;
begin
  foreach t in array array['lpe_phase_instances','lpe_goal_instances'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (
         private.is_org_staff(organisation_id)
         or programme_instance_id in (
           select pi.id from public.lpe_programme_instances pi
           join public.lpe_enrollments e on e.id = pi.enrollment_id
           where e.patient_id = (select auth.uid())))', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
         using (private.is_org_staff(organisation_id))
         with check (private.is_org_staff(organisation_id))', t, t);
  end loop;
end $$;
