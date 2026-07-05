-- Tarragon Health — Sprint 1 foundation
-- 02 · Chronic Disease Management (Category 1)
--
-- vitals, care plans, medications + adherence, risk scores, appointments,
-- symptoms, nurse alerts, and the four-level clinical escalation chain.
--
-- RLS pattern for patient-scoped tables:
--   * patient sees/manages their own rows (patient_id = auth.uid())
--   * org staff (clinician/admin) see/manage rows in their org
-- organisation_id is denormalised onto every clinical table so RLS can be
-- evaluated with a single indexed predicate (no cross-table joins in policies).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.vital_type as enum (
  'blood_pressure', 'glucose', 'weight', 'pulse', 'temperature', 'spo2'
);

create type public.glucose_context as enum ('fasting', 'random', 'post_meal');

create type public.care_plan_condition as enum (
  'hypertension', 'diabetes', 'obesity', 'ckd', 'cardiovascular', 'other'
);

create type public.care_plan_status as enum (
  'draft', 'active', 'completed', 'cancelled'
);

create type public.medication_log_status as enum ('taken', 'missed', 'skipped');

create type public.risk_level as enum ('low', 'moderate', 'high', 'very_high');

create type public.appointment_status as enum (
  'scheduled', 'completed', 'cancelled', 'no_show'
);

-- Four-level clinical escalation (FEATURE_SPEC §5.2).
create type public.alert_level as enum (
  'routine', 'nurse_review', 'doctor_escalation', 'emergency'
);

create type public.alert_status as enum ('open', 'acknowledged', 'resolved');

create type public.escalation_status as enum (
  'open', 'under_review', 'resolved', 'referred'
);

-- ---------------------------------------------------------------------------
-- vitals_readings (patient-authored)
-- ---------------------------------------------------------------------------

create table public.vitals_readings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  vital_type        public.vital_type not null,
  systolic          integer,
  diastolic         integer,
  glucose_mmol_l    numeric(5, 2),
  glucose_context   public.glucose_context,
  weight_kg         numeric(5, 2),
  pulse_bpm         integer,
  temperature_c     numeric(4, 1),
  spo2_pct          integer,
  note              text,
  taken_at          timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index vitals_readings_patient_idx on public.vitals_readings (patient_id, taken_at desc);
create index vitals_readings_org_idx on public.vitals_readings (organisation_id);

-- ---------------------------------------------------------------------------
-- care_plans (clinician-authored; patient read-only)
-- ---------------------------------------------------------------------------

create table public.care_plans (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  condition         public.care_plan_condition not null,
  status            public.care_plan_status not null default 'draft',
  target_ranges     jsonb not null default '{}'::jsonb,
  notes             text,
  assigned_nurse_id uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index care_plans_patient_idx on public.care_plans (patient_id);
create index care_plans_org_idx on public.care_plans (organisation_id);
create index care_plans_assigned_nurse_idx on public.care_plans (assigned_nurse_id);

create trigger care_plans_set_updated_at
  before update on public.care_plans
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- medications (clinician-authored)
-- ---------------------------------------------------------------------------

create table public.medications (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  care_plan_id      uuid references public.care_plans (id) on delete set null,
  drug_name         text not null,
  dose              text,
  frequency         text,
  refill_date       date,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index medications_patient_idx on public.medications (patient_id);
create index medications_org_idx on public.medications (organisation_id);
create index medications_care_plan_idx on public.medications (care_plan_id);

create trigger medications_set_updated_at
  before update on public.medications
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- medication_logs (patient-authored adherence)
-- ---------------------------------------------------------------------------

create table public.medication_logs (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  status            public.medication_log_status not null,
  reason            text,
  logged_at         timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index medication_logs_patient_idx on public.medication_logs (patient_id, logged_at desc);
create index medication_logs_medication_idx on public.medication_logs (medication_id);
create index medication_logs_org_idx on public.medication_logs (organisation_id);

-- ---------------------------------------------------------------------------
-- patient_risk_scores (rule-based now, ML-based later; model_version tracked)
-- ---------------------------------------------------------------------------

create table public.patient_risk_scores (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  score_type        text not null,
  score             numeric(6, 2),
  risk_level        public.risk_level,
  model_version     text,
  inputs            jsonb not null default '{}'::jsonb,
  computed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index patient_risk_scores_patient_idx on public.patient_risk_scores (patient_id, computed_at desc);
create index patient_risk_scores_org_idx on public.patient_risk_scores (organisation_id);

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------

create table public.appointments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  clinician_id      uuid references public.profiles (id) on delete set null,
  scheduled_for     timestamptz not null,
  status            public.appointment_status not null default 'scheduled',
  reason            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index appointments_patient_idx on public.appointments (patient_id, scheduled_for desc);
create index appointments_org_idx on public.appointments (organisation_id);
create index appointments_clinician_idx on public.appointments (clinician_id);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- symptoms (patient-reported; red-flag rules drive escalation)
-- ---------------------------------------------------------------------------

create table public.symptoms (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  description       text not null,
  is_red_flag       boolean not null default false,
  severity          integer check (severity between 1 and 10),
  reported_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index symptoms_patient_idx on public.symptoms (patient_id, reported_at desc);
create index symptoms_org_idx on public.symptoms (organisation_id);

-- ---------------------------------------------------------------------------
-- nurse_alerts (worklist items surfaced to clinical staff)
-- ---------------------------------------------------------------------------

create table public.nurse_alerts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  level             public.alert_level not null default 'nurse_review',
  status            public.alert_status not null default 'open',
  title             text not null,
  detail            text,
  -- 4-hour contact SLA for Priority-1 (abnormal-result) alerts.
  sla_due_at        timestamptz,
  acknowledged_by   uuid references public.profiles (id) on delete set null,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index nurse_alerts_org_status_idx on public.nurse_alerts (organisation_id, status, level);
create index nurse_alerts_patient_idx on public.nurse_alerts (patient_id);
create index nurse_alerts_acknowledged_by_idx on public.nurse_alerts (acknowledged_by);

create trigger nurse_alerts_set_updated_at
  before update on public.nurse_alerts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- escalations (nurse -> doctor -> referral chain)
-- ---------------------------------------------------------------------------

create table public.escalations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  nurse_alert_id    uuid references public.nurse_alerts (id) on delete set null,
  status            public.escalation_status not null default 'open',
  raised_by         uuid references public.profiles (id) on delete set null,
  assigned_doctor_id uuid references public.profiles (id) on delete set null,
  reason            text not null,
  resolution_note   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index escalations_org_status_idx on public.escalations (organisation_id, status);
create index escalations_patient_idx on public.escalations (patient_id);
create index escalations_nurse_alert_idx on public.escalations (nurse_alert_id);
create index escalations_raised_by_idx on public.escalations (raised_by);
create index escalations_assigned_doctor_idx on public.escalations (assigned_doctor_id);

create trigger escalations_set_updated_at
  before update on public.escalations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.vitals_readings   enable row level security;
alter table public.care_plans        enable row level security;
alter table public.medications       enable row level security;
alter table public.medication_logs   enable row level security;
alter table public.patient_risk_scores enable row level security;
alter table public.appointments      enable row level security;
alter table public.symptoms          enable row level security;
alter table public.nurse_alerts      enable row level security;
alter table public.escalations       enable row level security;

-- Patient-authored tables: patient may read + write own rows; staff full access.
do $$
declare t text;
begin
  foreach t in array array['vitals_readings', 'medication_logs', 'symptoms']
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
        with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (private.is_org_staff(organisation_id));
    $f$, t);
  end loop;
end;
$$;

-- Clinician-authored tables: patient reads own rows; only staff may write.
do $$
declare t text;
begin
  foreach t in array array[
    'care_plans', 'medications', 'patient_risk_scores', 'appointments',
    'nurse_alerts', 'escalations'
  ]
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (private.is_org_staff(organisation_id));
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (private.is_org_staff(organisation_id))
        with check (private.is_org_staff(organisation_id));
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (private.is_org_staff(organisation_id));
    $f$, t);
  end loop;
end;
$$;

grant select, insert, update, delete on public.vitals_readings to authenticated;
grant select, insert, update, delete on public.care_plans to authenticated;
grant select, insert, update, delete on public.medications to authenticated;
grant select, insert, update, delete on public.medication_logs to authenticated;
grant select, insert, update, delete on public.patient_risk_scores to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.symptoms to authenticated;
grant select, insert, update, delete on public.nurse_alerts to authenticated;
grant select, insert, update, delete on public.escalations to authenticated;
