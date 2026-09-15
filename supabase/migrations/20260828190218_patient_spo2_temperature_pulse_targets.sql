-- Tarragon Health — Monitoring Engine: individualised targets for SpO2,
-- temperature, and pulse (§6.10 — "Never assume one universal target")
--
-- BP and glucose already have this (patient_bp_targets/patient_glucose_
-- targets, H5/§9) but SpO2 and temperature have only ever had the fixed
-- population bands baked into private.classify_spo2_level/classify_
-- temperature_level, and pulse's pattern assessment (assess-heart-rate.ts)
-- has a hardcoded 60-100bpm resting range. This closes that gap the same
-- way BP already did (private.patient_home_bp_target,
-- 20260720020150_bp_targets_and_hbpm.sql H5.3): an individualised target
-- can only ever make the ROUTINE ("amber") review threshold more or less
-- sensitive — the RED/EMERGENCY safety floor stays fixed for every
-- patient. This mirrors patient_glucose_targets' own explicit rule ("the
-- emergency / hypo thresholds are NEVER relaxed — safety is fixed").
--
-- Deliberately NOT a full custom emergency-floor remap for chronic
-- hypoxaemia — that is a real, distinct clinical policy decision needing
-- actual Clinical Director sign-off, flagged for that review, not decided
-- here.
--
-- classify_spo2_level()/classify_temperature_level() themselves are left
-- untouched (still the fixed population classifier, still what the TS
-- presentation-only badges mirror) — the override is applied as a second,
-- explicit step in each trigger, exactly like BP's H5.3, not folded into
-- the classifier itself.

create table public.patient_spo2_targets (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null unique references public.profiles (id) on delete cascade,
  amber_threshold_pct  smallint not null default 94 check (amber_threshold_pct > 92 and amber_threshold_pct <= 100),
  rationale            text,
  set_by               uuid references public.clinical_staff (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index patient_spo2_targets_org_idx on public.patient_spo2_targets (organisation_id);

drop trigger if exists patient_spo2_targets_set_updated_at on public.patient_spo2_targets;
create trigger patient_spo2_targets_set_updated_at
  before update on public.patient_spo2_targets
  for each row execute function private.set_updated_at();

alter table public.patient_spo2_targets enable row level security;

create policy patient_spo2_targets_select on public.patient_spo2_targets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_spo2_targets_write on public.patient_spo2_targets
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_spo2_targets to authenticated;

create table public.patient_temperature_targets (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null unique references public.profiles (id) on delete cascade,
  amber_threshold_c   numeric(3, 1) not null default 38.0 check (amber_threshold_c >= 37.0 and amber_threshold_c < 39.0),
  rationale           text,
  set_by              uuid references public.clinical_staff (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index patient_temperature_targets_org_idx on public.patient_temperature_targets (organisation_id);

drop trigger if exists patient_temperature_targets_set_updated_at on public.patient_temperature_targets;
create trigger patient_temperature_targets_set_updated_at
  before update on public.patient_temperature_targets
  for each row execute function private.set_updated_at();

alter table public.patient_temperature_targets enable row level security;

create policy patient_temperature_targets_select on public.patient_temperature_targets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_temperature_targets_write on public.patient_temperature_targets
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_temperature_targets to authenticated;

create table public.patient_pulse_targets (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null unique references public.profiles (id) on delete cascade,
  resting_min_bpm     smallint not null default 60 check (resting_min_bpm between 30 and 150),
  resting_max_bpm     smallint not null default 100 check (resting_max_bpm between 30 and 150),
  rationale           text,
  set_by              uuid references public.clinical_staff (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint patient_pulse_targets_range_check check (resting_min_bpm < resting_max_bpm)
);
create index patient_pulse_targets_org_idx on public.patient_pulse_targets (organisation_id);

drop trigger if exists patient_pulse_targets_set_updated_at on public.patient_pulse_targets;
create trigger patient_pulse_targets_set_updated_at
  before update on public.patient_pulse_targets
  for each row execute function private.set_updated_at();

alter table public.patient_pulse_targets enable row level security;

create policy patient_pulse_targets_select on public.patient_pulse_targets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_pulse_targets_write on public.patient_pulse_targets
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_pulse_targets to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'patient_spo2_targets') then
    raise exception 'FAIL: patient_spo2_targets was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'patient_temperature_targets') then
    raise exception 'FAIL: patient_temperature_targets was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'patient_pulse_targets') then
    raise exception 'FAIL: patient_pulse_targets was not created';
  end if;

  raise notice 'PASS: individualised SpO2/temperature/pulse target tables installed';
end $$;
