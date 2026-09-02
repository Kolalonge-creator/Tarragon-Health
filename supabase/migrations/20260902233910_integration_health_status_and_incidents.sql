-- Tarragon Health — Device & Data Operations, part 5/6: integration health + clinical downtime (55.11, 55.16, 55.17).
--
-- Confirmed before writing this: no integration-health/system-status table or dashboard exists
-- anywhere in the codebase (grepped for integration_health/system_status/service_status — zero
-- matches). This is greenfield, modelled on the one existing precedent for global, non-tenant-
-- scoped reference/status data: public.device_catalog (authenticated read, admin/service write, no
-- organisation_id column) — integration health is a platform-wide infrastructure signal, not
-- per-tenant data, the same way the device catalogue is.
--
-- 13 components cover every real ingestion path documented in CLAUDE.md's Device & Wearable
-- Integration section: 5 BLE clinical-device profiles (BP/glucose/scale/thermometer/SpO2), 5 cloud-
-- OAuth wearable providers, the 2 mobile-bridge platforms (Apple Health / Health Connect), and the
-- mobile ingestion API itself as a catch-all for the upload path independent of any one provider.
-- integration_health_status is a computed, service-role-maintained status per component (an app-
-- layer health-check route upserts it — this migration is schema only, no cron/Edge Function is
-- created here). integration_incidents is the append-style downtime-window ledger 55.16's
-- "technical downtime" metric and 55.17's workflow both read.
--
-- 55.17's "RPM unavailable -> clinical operations notified -> patients requiring urgent monitoring
-- identified" is implemented as a real, per-patient clinician_alerts fan-out (via the existing
-- private.raise_clinician_alert() helper, 20260828015618) rather than a vague summary count or a
-- new ad hoc notification path — a genuinely-affected patient (one relying on the now-down
-- component, per private.integration_component_affected_patients() below, AND on an active chronic
-- care plan) gets an individually queryable, individually actionable alert, using the exact same
-- governed alert_rules/notification/ack-timeout machinery every other clinician_alerts row already
-- gets. "Fallback process" (55.17) is deliberately not modelled as new schema: it is whatever the
-- assigned clinician does with that alert (the existing worklist/resolution flow), same as every
-- other operational alert type in this codebase.

create type public.integration_component as enum (
  'ble_bp_cuff', 'ble_glucometer', 'ble_scale', 'ble_thermometer', 'ble_pulse_oximeter',
  'wearable_oura', 'wearable_whoop', 'wearable_garmin', 'wearable_fitbit', 'wearable_dexcom',
  'apple_health_bridge', 'android_health_connect_bridge',
  'mobile_ingestion_api'
);

create type public.integration_health_state as enum ('operational', 'degraded', 'delayed', 'down');

create table public.integration_health_status (
  id                    uuid primary key default gen_random_uuid(),
  component             public.integration_component not null unique,
  state                 public.integration_health_state not null default 'operational',
  last_checked_at       timestamptz not null default now(),
  last_success_at       timestamptz,
  last_error            text,
  consecutive_failures  integer not null default 0,
  updated_at            timestamptz not null default now()
);

comment on table public.integration_health_status is
  '55.11 integration health, one row per ingestion component. Global/platform-wide like device_catalog (no organisation_id) — computed and maintained by a service-role health-check route, never client-writable. See 20260829023051''s header for the full component list rationale.';

create trigger integration_health_status_set_updated_at
  before update on public.integration_health_status
  for each row execute function private.set_updated_at();

alter table public.integration_health_status enable row level security;

create policy integration_health_status_select on public.integration_health_status
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role <> 'patient'));

grant select on public.integration_health_status to authenticated;

insert into public.integration_health_status (component, state)
select c, 'operational'::public.integration_health_state
from unnest(enum_range(null::public.integration_component)) as c
on conflict (component) do nothing;

create table public.integration_incidents (
  id                      uuid primary key default gen_random_uuid(),
  component               public.integration_component not null,
  state                   public.integration_health_state not null,
  started_at              timestamptz not null default now(),
  resolved_at             timestamptz,
  detail                  text,
  clinical_ops_notified_at timestamptz,
  created_at              timestamptz not null default now()
);

comment on table public.integration_incidents is
  '55.16 technical-downtime ledger + 55.17 clinical-downtime workflow trigger point. One row per downtime/degradation window per component, opened by the same service-role health-check route that maintains integration_health_status. A state=down insert fires private.handle_integration_incident_opened() (BEFORE INSERT) which raises the 55.17 clinician_alerts fan-out and stamps clinical_ops_notified_at in the same row.';

create index integration_incidents_component_idx on public.integration_incidents (component, started_at desc);
create index integration_incidents_open_idx on public.integration_incidents (component) where resolved_at is null;

alter table public.integration_incidents enable row level security;

create policy integration_incidents_select on public.integration_incidents
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role <> 'patient'));

grant select on public.integration_incidents to authenticated;

-- ---------------------------------------------------------------------------
-- Affected-patient lookup. Maps a component to its underlying connection
-- table + provider/device_type value, then narrows to patients on an active
-- chronic (hypertension/diabetes) care plan — "requiring urgent monitoring"
-- (55.17), not "ever paired a device" (which would be most patients).
-- mobile_ingestion_api is the catch-all: it is the shared upload path behind
-- every other component, so its blast radius is the union of all of them.
-- ---------------------------------------------------------------------------
create or replace function private.integration_component_affected_patients(p_component public.integration_component)
returns table (organisation_id uuid, patient_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select pd.organisation_id, pd.patient_id
    from public.patient_devices pd
    where pd.status = 'active'
      and (
        (p_component = 'mobile_ingestion_api')
        or (p_component::text like 'ble_%' and pd.device_type::text = substring(p_component::text from 5))
      )
    union
    select wc.organisation_id, wc.patient_id
    from public.wearable_connections wc
    where wc.status = 'active'
      and (
        (p_component = 'mobile_ingestion_api')
        or (p_component::text like 'wearable_%' and wc.provider::text = substring(p_component::text from 10))
        or (p_component = 'apple_health_bridge' and wc.provider = 'apple_health')
        or (p_component = 'android_health_connect_bridge' and wc.provider = 'android_health_connect')
      )
  )
  select distinct c.organisation_id, c.patient_id
  from candidates c
  where exists (
    select 1 from public.care_plans cp
    where cp.patient_id = c.patient_id
      and cp.status = 'active'
      and cp.condition in ('hypertension', 'diabetes')
  );
$$;

comment on function private.integration_component_affected_patients(public.integration_component) is
  '55.17 "patients requiring urgent monitoring identified". Returns patients with an active connection/pairing for the given component AND an active chronic care plan — the population a downed pipeline could actually cause a missed clinical signal for, not every patient who ever paired a device.';

revoke all on function private.integration_component_affected_patients(public.integration_component) from public, anon;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: a state=down row raises one clinician_alerts row per
-- affected patient (reusing the existing shared helper, 20260828015618) and
-- stamps clinical_ops_notified_at on the incident itself in the same insert.
-- A belt-and-suspenders not-exists guard (same idiom as the other operational
-- sweeps in that migration) stops a flapping health check from re-raising
-- the same patient's alert inside its own 24h dedup window.
-- ---------------------------------------------------------------------------
create or replace function private.handle_integration_incident_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient record;
  v_count integer := 0;
begin
  for v_patient in select * from private.integration_component_affected_patients(new.component) loop
    if not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'monitoring_pipeline_down' and ca.patient_id = v_patient.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    ) then
      perform private.raise_clinician_alert(
        v_patient.organisation_id, v_patient.patient_id, 'clinician_review',
        format('Device monitoring pipeline down: %s', new.component),
        format(
          'The %s data pipeline went down at %s%s. This patient is on an active chronic care plan and relies on it — readings may not be arriving. Consider a manual check-in or asking the patient to log readings by hand until this is resolved.',
          new.component, to_char(new.started_at, 'YYYY-MM-DD HH24:MI'),
          case when new.detail is not null then '. ' || new.detail else '' end
        ),
        'operational', 'monitoring_pipeline_down'
      );
      v_count := v_count + 1;
    end if;
  end loop;

  new.clinical_ops_notified_at := now();
  new.detail := coalesce(new.detail, '') ||
    format(' [%s patient(s) with an active chronic care plan flagged for urgent monitoring.]', v_count);

  return new;
end;
$$;

comment on function private.handle_integration_incident_opened() is
  '55.17 clinical downtime workflow. Fires only when a new integration_incidents row has state=down. Raises one clinician_alerts row (type_code=monitoring_pipeline_down) per affected, currently-un-alerted patient via the shared private.raise_clinician_alert() helper, then stamps clinical_ops_notified_at + an affected-patient count onto the incident row itself in the same insert.';

create trigger integration_incidents_notify_on_down
  before insert on public.integration_incidents
  for each row
  when (new.state = 'down')
  execute function private.handle_integration_incident_opened();

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
declare
  v_seed_count integer;
begin
  select count(*) into v_seed_count from public.integration_health_status;
  if v_seed_count <> 13 then
    raise exception 'expected 13 seeded integration_health_status rows, found %', v_seed_count;
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'integration_incidents_notify_on_down'
      and tgrelid = 'public.integration_incidents'::regclass and not tgisinternal
  ) then
    raise exception 'integration_incidents_notify_on_down trigger was not created';
  end if;
  if has_function_privilege('anon', 'private.integration_component_affected_patients(public.integration_component)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.integration_component_affected_patients';
  end if;
  raise notice 'PASS: integration_health_status (13 rows), integration_incidents, and the 55.17 downtime-notify trigger are all in place';
end $$;
