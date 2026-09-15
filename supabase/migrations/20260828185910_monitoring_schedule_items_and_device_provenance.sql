-- Tarragon Health — Monitoring Engine: structured monitoring schedule
-- (spec §6.3/§6.4/§6.8) + device registration provenance (§6.18)
--
-- Today "which vitals a condition tracks" only exists as
-- chronic_condition_programmes.monitoring_vitals (a bare vital_type[] list)
-- plus free-text guidance in condition_protocols.monitoring (a jsonb blob
-- like "Uncontrolled: review every 2-4 weeks..."). Nothing ties a specific
-- PATIENT to a specific frequency/target/acceptable-range/escalation-
-- threshold/responsible-clinician/instructions for a specific vital — the
-- spec's §6.4 example ("BP three times weekly... target range... escalation
-- threshold... responsible clinician... patient instructions") has no home.
--
-- monitoring_schedule_items is that home: one row per patient+vital_type
-- being actively monitored. Auto-seeded from a chronic programme enrolment
-- (private.seed_monitoring_schedule_on_enrolment, mirroring how
-- chronic_programme_enrolments already spawns a care_plan) using a sane
-- per-condition default frequency, then editable per-patient by the
-- responsible clinician — exactly the "configurable... individual patient
-- plan" requirement in §6.10, never a single universal number.
--
-- Baseline (§6.8) lives here too: baseline_value is set automatically from
-- the patient's first reading once a schedule item goes active
-- (private.set_monitoring_baseline_on_first_reading, a trigger on
-- vitals_readings — cannot be set at schedule-item-creation time because no
-- reading exists yet), or explicitly by a clinician via
-- public.set_monitoring_baseline() when a documented pre-programme baseline
-- (e.g. a clinic reading) should be used instead of "whatever the patient
-- happened to log first".
--
-- reminder_stage reuses the SAME public.reminder_stage enum
-- (upcoming/due/overdue/escalated) added by 20260827205740_escalating_
-- preventive_reminders.sql for screening/vaccination — one ladder concept,
-- not a second bespoke one. The engine that walks it
-- (private.evaluate_vitals_monitoring_gaps) ships in the next migration,
-- once adherence computation exists to reason about "missed" at all.

create type public.monitoring_item_status as enum ('active', 'paused', 'completed');
create type public.monitoring_baseline_source as enum ('first_reading', 'clinician_set');

create table public.monitoring_schedule_items (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  programme_id             uuid references public.chronic_condition_programmes (id) on delete set null,
  care_plan_id             uuid references public.care_plans (id) on delete set null,
  vital_type               public.vital_type not null,
  -- 1-21 covers everything from weekly to several-times-daily (e.g. a
  -- heart-failure daily-weight-and-BP-and-symptoms protocol is still <= 7).
  frequency_per_week       integer not null check (frequency_per_week > 0 and frequency_per_week <= 21),
  start_date               date not null default current_date,
  end_date                 date,
  -- Single-point clinical target, e.g. {"systolic": 130, "diastolic": 80}.
  target                   jsonb,
  -- Acceptable band around the target, distinct from it per §6.10's
  -- "never assume one universal target" — e.g. {"systolic": {"min": 100, "max": 140}}.
  acceptable_range         jsonb,
  -- What triggers escalation beyond the platform's own hard-coded red-flag
  -- bands (e.g. {"consecutive_above_target": 2}) — clinician-set nuance on
  -- top of the always-on safety triggers, never a replacement for them.
  escalation_threshold     jsonb,
  responsible_clinician_id uuid references public.clinical_staff (id) on delete set null,
  patient_instructions     text,
  status                   public.monitoring_item_status not null default 'active',
  baseline_value           jsonb,
  baseline_source          public.monitoring_baseline_source,
  baseline_set_at          timestamptz,
  reminder_stage           public.reminder_stage,
  reminder_sent_at         timestamptz,
  created_by               uuid references public.profiles (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint monitoring_schedule_items_dates_check check (end_date is null or end_date >= start_date)
);

comment on column public.monitoring_schedule_items.reminder_stage is
  'Same upcoming->due->overdue->escalated ladder as screening_schedules.reminder_stage — see '
  'private.evaluate_vitals_monitoring_gaps(). Null = no gap currently open. Resets to null the moment '
  'a matching reading arrives (private.reset_monitoring_gap_on_reading).';

-- One ACTIVE item per patient+vital_type — a superseded item (frequency
-- changed, programme ended) is completed/paused, never deleted, so history
-- of what was prescribed when survives.
create unique index monitoring_schedule_items_one_active_idx
  on public.monitoring_schedule_items (patient_id, vital_type)
  where status = 'active';
create index monitoring_schedule_items_patient_idx on public.monitoring_schedule_items (patient_id);
create index monitoring_schedule_items_org_idx on public.monitoring_schedule_items (organisation_id, status);
create index monitoring_schedule_items_programme_idx on public.monitoring_schedule_items (programme_id);
create index monitoring_schedule_items_gap_scan_idx
  on public.monitoring_schedule_items (status, reminder_stage)
  where status = 'active';

drop trigger if exists monitoring_schedule_items_set_updated_at on public.monitoring_schedule_items;
create trigger monitoring_schedule_items_set_updated_at
  before update on public.monitoring_schedule_items
  for each row execute function private.set_updated_at();

alter table public.monitoring_schedule_items enable row level security;

-- Patient reads their own schedule (frequency/target/instructions are
-- exactly what the patient dashboard's "My monitoring" needs); only org
-- staff write it — same ownership split as care_plans.
drop policy if exists monitoring_schedule_items_select on public.monitoring_schedule_items;
create policy monitoring_schedule_items_select on public.monitoring_schedule_items
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists monitoring_schedule_items_insert on public.monitoring_schedule_items;
create policy monitoring_schedule_items_insert on public.monitoring_schedule_items
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists monitoring_schedule_items_update on public.monitoring_schedule_items;
create policy monitoring_schedule_items_update on public.monitoring_schedule_items
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists monitoring_schedule_items_delete on public.monitoring_schedule_items;
create policy monitoring_schedule_items_delete on public.monitoring_schedule_items
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

-- A freshly created table needs its own grant — RLS restricts rows, it does
-- not grant table-level access, and Supabase only auto-provisions this at
-- project creation (see CLAUDE.md's authenticated-table-grants lesson,
-- which has bitten this codebase three separate times already).
grant select, insert, update, delete on public.monitoring_schedule_items to authenticated;

-- ---------------------------------------------------------------------------
-- Default per-condition frequency — config, reused by the auto-seed trigger.
-- Grounded directly in the spec's own worked examples (hypertension: BP 3x/
-- week; heart failure: daily weight+BP). Everything else is a conservative
-- once-a-week default a clinician can override per patient.
-- ---------------------------------------------------------------------------

create or replace function private.default_monitoring_frequency(
  p_condition public.care_plan_condition,
  p_vital_type public.vital_type
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_condition = 'heart_failure' then 7
    when p_condition = 'diabetes' and p_vital_type = 'glucose' then 7
    when p_condition = 'diabetes' and p_vital_type = 'blood_pressure' then 3
    when p_condition = 'diabetes' and p_vital_type = 'weight' then 1
    when p_condition = 'hypertension' and p_vital_type in ('blood_pressure', 'pulse') then 3
    when p_condition = 'obesity' and p_vital_type = 'weight' then 1
    when p_condition = 'obesity' and p_vital_type = 'blood_pressure' then 3
    when p_condition = 'ckd' and p_vital_type = 'blood_pressure' then 3
    when p_condition in ('asthma', 'copd') and p_vital_type in ('spo2', 'pulse') then 3
    else 1
  end;
$$;

create or replace function private.seed_monitoring_schedule_on_enrolment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.care_plan_condition;
  v_vitals    public.vital_type[];
  v_vital     public.vital_type;
begin
  if new.status <> 'enrolled' then
    return new;
  end if;

  select condition, monitoring_vitals into v_condition, v_vitals
  from public.chronic_condition_programmes
  where id = new.programme_id;

  if v_vitals is null then
    return new;
  end if;

  foreach v_vital in array v_vitals loop
    if not exists (
      select 1 from public.monitoring_schedule_items
      where patient_id = new.patient_id and vital_type = v_vital and status = 'active'
    ) then
      insert into public.monitoring_schedule_items
        (organisation_id, patient_id, programme_id, care_plan_id, vital_type, frequency_per_week)
      values (
        new.organisation_id, new.patient_id, new.programme_id, new.care_plan_id, v_vital,
        private.default_monitoring_frequency(v_condition, v_vital)
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists chronic_enrolments_seed_monitoring_schedule on public.chronic_programme_enrolments;
create trigger chronic_enrolments_seed_monitoring_schedule
  after insert or update on public.chronic_programme_enrolments
  for each row
  when (new.status = 'enrolled')
  execute function private.seed_monitoring_schedule_on_enrolment();

-- ---------------------------------------------------------------------------
-- Baseline auto-capture: the patient's first reading after a schedule item
-- goes active becomes its baseline, unless a clinician has already set one.
-- ---------------------------------------------------------------------------

create or replace function private.set_monitoring_baseline_on_first_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_baseline jsonb;
begin
  v_baseline := case new.vital_type
    when 'blood_pressure' then jsonb_build_object('systolic', new.systolic, 'diastolic', new.diastolic)
    when 'glucose' then jsonb_build_object('glucose_mmol_l', new.glucose_mmol_l)
    when 'weight' then jsonb_build_object('weight_kg', new.weight_kg)
    when 'pulse' then jsonb_build_object('pulse_bpm', new.pulse_bpm)
    when 'temperature' then jsonb_build_object('temperature_c', new.temperature_c)
    when 'spo2' then jsonb_build_object('spo2_pct', new.spo2_pct)
    when 'waist_circumference' then jsonb_build_object('waist_cm', new.waist_cm)
    else null
  end;

  if v_baseline is null then
    return new;
  end if;

  update public.monitoring_schedule_items
    set baseline_value = v_baseline, baseline_source = 'first_reading', baseline_set_at = now()
  where patient_id = new.patient_id
    and vital_type = new.vital_type
    and status = 'active'
    and baseline_value is null;

  return new;
end;
$$;

drop trigger if exists vitals_readings_set_monitoring_baseline on public.vitals_readings;
create trigger vitals_readings_set_monitoring_baseline
  after insert on public.vitals_readings
  for each row
  execute function private.set_monitoring_baseline_on_first_reading();

create or replace function public.set_monitoring_baseline(p_item_id uuid, p_baseline jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.monitoring_schedule_items where id = p_item_id;
  if v_org is null then
    raise exception 'Monitoring schedule item not found' using errcode = 'no_data_found';
  end if;
  if not private.is_org_staff(v_org) then
    raise exception 'Not authorised' using errcode = 'insufficient_privilege';
  end if;

  update public.monitoring_schedule_items
    set baseline_value = p_baseline, baseline_source = 'clinician_set', baseline_set_at = now()
  where id = p_item_id;
end;
$$;

grant execute on function public.set_monitoring_baseline(uuid, jsonb) to authenticated;
revoke execute on function public.set_monitoring_baseline(uuid, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Device registration provenance (§6.18) — patient_devices carries pairing
-- state (manufacturer/model/status/paired_at/last_synced_at) but never
-- serial/calibration/firmware. ble_device_id remains the join key (it's the
-- OS-level BLE peripheral identifier, app-install-local) — these are
-- additional, optional facts about the physical unit, populated when a
-- device's GATT profile or manufacturer app actually surfaces them.
-- ---------------------------------------------------------------------------

alter table public.patient_devices
  add column if not exists serial_number     text,
  add column if not exists calibration_status text,
  add column if not exists firmware_version   text;

alter table public.patient_devices
  add constraint patient_devices_calibration_status_check
    check (calibration_status is null or calibration_status in ('calibrated', 'due', 'overdue', 'unknown'));

comment on column public.patient_devices.serial_number is
  'Manufacturer-issued hardware serial, distinct from ble_device_id (the app-install-local BLE peripheral UUID). Optional — most consumer devices never surface this over BLE.';
comment on column public.patient_devices.calibration_status is
  'Self- or staff-recorded calibration state, where the device model has a published calibration interval. Null when not tracked.';
comment on column public.patient_devices.firmware_version is
  'Device firmware/software version, where the BLE GATT profile or manufacturer app surfaces it.';

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'monitoring_schedule_items'
  ) then
    raise exception 'FAIL: monitoring_schedule_items was not created';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'chronic_enrolments_seed_monitoring_schedule'
  ) then
    raise exception 'FAIL: chronic_enrolments_seed_monitoring_schedule trigger was not installed';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'vitals_readings_set_monitoring_baseline'
  ) then
    raise exception 'FAIL: vitals_readings_set_monitoring_baseline trigger was not installed';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_devices' and column_name = 'serial_number'
  ) then
    raise exception 'FAIL: patient_devices.serial_number was not added';
  end if;

  raise notice 'PASS: monitoring_schedule_items + device provenance installed';
end $$;
