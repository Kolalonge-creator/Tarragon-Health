-- CGM (continuous glucose monitoring) ingestion boundary.
--
-- P3 of docs/OMADA_FEATURE_PROPOSALS.md §3. Built as a DORMANT, partner-gated
-- boundary: CGM readings flow into the existing vitals_readings table (no
-- parallel table), exactly like the Bluetooth clinical-device path. There is
-- no active CGM partner in Nigeria yet, so the seeded partner row is INACTIVE
-- and no patient can connect until ops onboards a real partner + activates it —
-- the patient-facing feature is live in code but dormant in practice.
--
-- HONEST SCOPE NOTE: like the existing device-BP path, an abnormal CGM reading
-- written here does NOT auto-raise a clinician_alert/escalation — there is no
-- trigger on vitals_readings today (only the app-layer ML risk-score path fires
-- from a vitals insert, and there is no glucose equivalent of
-- assessBpControlBestEffort yet). Wiring abnormal-CGM → escalation is a
-- deliberate follow-up, not silently assumed here.

-- Global CGM partner catalogue (no organisation_id — a shared directory, same
-- shape as home_visit_providers/logistics_partners). Authenticated read of
-- active rows; admin write.
create table if not exists public.cgm_partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists cgm_partners_set_updated_at on public.cgm_partners;
create trigger cgm_partners_set_updated_at
  before update on public.cgm_partners
  for each row execute function private.set_updated_at();

alter table public.cgm_partners enable row level security;

drop policy if exists cgm_partners_select on public.cgm_partners;
create policy cgm_partners_select on public.cgm_partners
  for select to authenticated
  using (is_active or private.is_admin());

drop policy if exists cgm_partners_write on public.cgm_partners;
create policy cgm_partners_write on public.cgm_partners
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.cgm_partners to authenticated;

-- One inactive placeholder — flipping is_active (and a real patient connection)
-- is the entire mechanism that turns the feature on. No feature flag.
insert into public.cgm_partners (name, code, is_active)
values ('CGM partner (coming soon)', 'placeholder', false)
on conflict (code) do nothing;

-- Patient ↔ CGM partner link. A connection existing + active is what makes the
-- ingestion endpoint accept readings for that patient.
create table if not exists public.cgm_connections (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  cgm_partner_id     uuid not null references public.cgm_partners (id) on delete restrict,
  external_device_id text,
  status             text not null default 'active' check (status in ('active', 'disconnected')),
  connected_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cgm_connections_patient_idx
  on public.cgm_connections (patient_id, status);

drop trigger if exists cgm_connections_set_updated_at on public.cgm_connections;
create trigger cgm_connections_set_updated_at
  before update on public.cgm_connections
  for each row execute function private.set_updated_at();

alter table public.cgm_connections enable row level security;

drop policy if exists cgm_connections_select on public.cgm_connections;
create policy cgm_connections_select on public.cgm_connections
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists cgm_connections_insert on public.cgm_connections;
create policy cgm_connections_insert on public.cgm_connections
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists cgm_connections_update on public.cgm_connections;
create policy cgm_connections_update on public.cgm_connections
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.cgm_connections to authenticated;

-- CGM readings live in vitals_readings (source='cgm'); this FK links each
-- reading to the connection that produced it and backs a CGM-specific
-- idempotent dedupe (a partner replay must not double-insert).
alter table public.vitals_readings
  add column if not exists cgm_connection_id uuid references public.cgm_connections (id) on delete set null;

create unique index if not exists vitals_readings_cgm_dedupe_idx
  on public.vitals_readings (cgm_connection_id, external_reading_id)
  where cgm_connection_id is not null and external_reading_id is not null;
