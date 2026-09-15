-- Tarragon Health — Operations: unified incident register (Module 30.18)
--
-- The platform already had TWO incident silos, each correct for its own
-- regulator but neither able to answer "what is going wrong at Tarragon right
-- now?":
--   * public.clinical_incident_reports (20260826225518) — clinical harm /
--     near-miss, owned by clinical governance.
--   * public.data_breach_incidents (20260731015650) — NDPR personal-data
--     breach, with its own statutory 72-hour notification deadline clock.
-- Neither covers a Paystack outage, a leaked service key, a mis-settled
-- partner payout, or a courier that never collected — and there was nowhere
-- at all to record those.
--
-- This migration adds ONE register above both, covering all six incident
-- categories the operations spec names (clinical / technical / privacy /
-- security / financial / operational). It deliberately does NOT replace the
-- two existing tables: each keeps its regulator-shaped fields and its own
-- workflow, and an ops_incidents row LINKS to one via a nullable FK. That
-- keeps clinical governance and NDPR reporting exactly as they are while
-- giving operations a single queue, a single severity scale, and a single
-- SLA clock.
--
-- Sizing note for a small team: there is no separate "incident manager" role.
-- Any member holding `incidents.manage` owns the register, and the same row
-- carries the ops timeline, the root cause, and the corrective/preventive
-- actions — three artefacts a larger company would keep in three systems.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.ops_incident_category as enum (
  'clinical', 'technical', 'privacy', 'security', 'financial', 'operational'
);

-- Four levels, not five: at this team size a fifth tier is a distinction
-- nobody would act on differently.
--   sev1 patient safety at risk / platform down / confirmed data breach
--   sev2 a core journey broken for many, or money moving wrongly
--   sev3 degraded but worked around
--   sev4 cosmetic, logged for the trend
create type public.ops_incident_severity as enum ('sev1', 'sev2', 'sev3', 'sev4');

create type public.ops_incident_status as enum (
  'open', 'investigating', 'mitigated', 'resolved', 'closed'
);

-- ---------------------------------------------------------------------------
-- 2. Severity SLA targets — data, not code.
--    Same discipline as public.escalation_slas: the numbers a dashboard turns
--    red against live in a table an admin can review, never inlined in a
--    trigger body or a React component.
-- ---------------------------------------------------------------------------
create table public.ops_incident_sla_targets (
  severity          public.ops_incident_severity primary key,
  ack_minutes       integer not null check (ack_minutes > 0),
  resolve_minutes   integer not null check (resolve_minutes > 0),
  description       text,
  updated_at        timestamptz not null default now()
);

create trigger ops_incident_sla_targets_set_updated_at
  before update on public.ops_incident_sla_targets
  for each row execute function private.set_updated_at();

insert into public.ops_incident_sla_targets (severity, ack_minutes, resolve_minutes, description) values
  ('sev1',   15,   240, 'Patient safety at risk, platform down, or a confirmed data breach. Acknowledge within 15 minutes, mitigate within 4 hours.'),
  ('sev2',   60,  1440, 'A core journey is broken for many patients, or money is moving incorrectly. Same working day.'),
  ('sev3',  480,  4320, 'Degraded but with a workaround in place. Three working days.'),
  ('sev4', 2880, 20160, 'Cosmetic or low impact. Logged so the trend is visible; two weeks.');

-- ---------------------------------------------------------------------------
-- 3. The register
-- ---------------------------------------------------------------------------
create sequence public.ops_incident_reference_seq;

create table public.ops_incidents (
  id                    uuid primary key default gen_random_uuid(),
  -- Human-quotable handle for a WhatsApp thread or a call with a partner.
  reference             text not null unique
                          default 'INC-' || to_char(now() at time zone 'Africa/Lagos', 'YYYY')
                                 || '-' || lpad(nextval('public.ops_incident_reference_seq')::text, 4, '0'),
  -- Null = platform-wide, which is the common case for a technical incident.
  -- Set when the impact is contained to one employer/HMO tenant.
  organisation_id       uuid references public.organisations (id) on delete set null,
  category              public.ops_incident_category not null,
  severity              public.ops_incident_severity not null,
  status                public.ops_incident_status not null default 'open',
  title                 text not null check (length(btrim(title)) > 0),
  summary               text,

  -- Lifecycle. detected_at is when it STARTED being a problem (often earlier
  -- than the row); the rest are stamped by the status trigger below.
  detected_at           timestamptz not null default now(),
  acknowledged_at       timestamptz,
  mitigated_at          timestamptz,
  resolved_at           timestamptz,
  closed_at             timestamptz,

  -- SLA clocks, frozen at insert from the targets table so a later change to
  -- the targets never silently re-judges an incident that has already run.
  ack_due_at            timestamptz not null,
  resolve_due_at        timestamptz not null,

  reported_by           uuid references public.profiles (id) on delete set null,
  owner_id              uuid references public.profiles (id) on delete set null,

  impact                text,
  patients_affected     integer check (patients_affected is null or patients_affected >= 0),
  root_cause            text,
  corrective_action     text,
  preventive_action     text,

  -- Links to the regulator-shaped records. An ops incident may be the ops
  -- view of a clinical incident or a data breach; it never duplicates them.
  clinical_incident_report_id uuid references public.clinical_incident_reports (id) on delete set null,
  data_breach_incident_id     uuid references public.data_breach_incidents (id) on delete set null,
  clinician_alert_id          uuid references public.clinician_alerts (id) on delete set null,

  -- Free-form pointer at whatever else triggered this (a payout batch, a
  -- lab order, a deployment id). Kept as text on purpose: the referenced
  -- thing is often outside the database.
  external_reference    text,

  requires_regulatory_notification boolean not null default false,
  regulatory_body       text,
  regulatory_notified_at timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- A resolved or closed incident must say what actually happened. This is
  -- the whole point of keeping a register rather than a chat log.
  constraint ops_incidents_resolved_needs_cause check (
    status not in ('resolved', 'closed') or root_cause is not null
  ),
  -- If it needs telling a regulator, name which one.
  constraint ops_incidents_regulatory_body_present check (
    not requires_regulatory_notification or regulatory_body is not null
  )
);

create index ops_incidents_open_idx
  on public.ops_incidents (severity, detected_at desc)
  where status <> 'closed';
create index ops_incidents_category_idx on public.ops_incidents (category, detected_at desc);
create index ops_incidents_owner_idx on public.ops_incidents (owner_id) where status <> 'closed';
create index ops_incidents_org_idx on public.ops_incidents (organisation_id, detected_at desc);
create index ops_incidents_ack_due_idx
  on public.ops_incidents (ack_due_at)
  where acknowledged_at is null and status <> 'closed';

create trigger ops_incidents_set_updated_at
  before update on public.ops_incidents
  for each row execute function private.set_updated_at();

comment on table public.ops_incidents is
  'Unified operations incident register across all six categories (Module 30.18). Sits ABOVE clinical_incident_reports and data_breach_incidents rather than replacing them — link to one via the nullable FKs; those tables keep their own regulator-shaped workflow.';

-- ---------------------------------------------------------------------------
-- 4. Append-only incident timeline
-- ---------------------------------------------------------------------------
create table public.ops_incident_updates (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.ops_incidents (id) on delete cascade,
  author_id     uuid references public.profiles (id) on delete set null,
  note          text not null check (length(btrim(note)) > 0),
  status_from   public.ops_incident_status,
  status_to     public.ops_incident_status,
  created_at    timestamptz not null default now()
);

create index ops_incident_updates_incident_idx
  on public.ops_incident_updates (incident_id, created_at);

-- Same immutability guard as public.audit_log: an incident timeline that can
-- be edited after the fact is not evidence of anything.
--
-- private.reject_mutation() hardcoded 'audit_log is append-only' in its
-- message, which was already wrong at its second call site
-- (record_corrections, 20260827195333) and would be wrong here too. Same
-- behaviour, accurate message — it names whichever table actually rejected.
create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%.% is append-only: % is not permitted',
    tg_table_schema, tg_table_name, tg_op;
end;
$$;

create trigger ops_incident_updates_no_update
  before update on public.ops_incident_updates
  for each row execute function private.reject_mutation();
create trigger ops_incident_updates_no_delete
  before delete on public.ops_incident_updates
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- 5. Triggers: freeze the SLA clocks at insert; stamp lifecycle timestamps
--    and record a timeline entry on every status change.
-- ---------------------------------------------------------------------------
create or replace function private.ops_incident_set_sla()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ack integer;
  v_res integer;
begin
  select ack_minutes, resolve_minutes into v_ack, v_res
  from public.ops_incident_sla_targets
  where severity = new.severity;

  -- The targets table is seeded for every enum member and only an admin can
  -- edit it, so a miss means the row was deleted. Fail loudly rather than
  -- inventing an SLA.
  if v_ack is null then
    raise exception 'No ops_incident_sla_targets row for severity %', new.severity;
  end if;

  new.ack_due_at     := coalesce(new.detected_at, now()) + make_interval(mins => v_ack);
  new.resolve_due_at := coalesce(new.detected_at, now()) + make_interval(mins => v_res);
  return new;
end;
$$;

create trigger ops_incidents_set_sla
  before insert on public.ops_incidents
  for each row execute function private.ops_incident_set_sla();

create or replace function private.ops_incident_stamp_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    -- Any movement off 'open' means a human has picked it up.
    if new.status <> 'open' and new.acknowledged_at is null then
      new.acknowledged_at := now();
    end if;
    if new.status in ('mitigated', 'resolved', 'closed') and new.mitigated_at is null then
      new.mitigated_at := now();
    end if;
    if new.status in ('resolved', 'closed') and new.resolved_at is null then
      new.resolved_at := now();
    end if;
    if new.status = 'closed' and new.closed_at is null then
      new.closed_at := now();
    end if;
    -- Reopening clears the downstream stamps so the clock is honest.
    if new.status in ('open', 'investigating') then
      new.mitigated_at := null;
      new.resolved_at  := null;
      new.closed_at    := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger ops_incidents_stamp_status
  before update on public.ops_incidents
  for each row execute function private.ops_incident_stamp_status();

-- The timeline entry is written AFTER the row lands so it records what
-- actually persisted, and so a status change can never be applied without
-- one — a note written only by the server action would be skippable.
create or replace function private.ops_incident_log_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.ops_incident_updates (incident_id, author_id, note, status_from, status_to)
    values (
      new.id,
      (select auth.uid()),
      format('Status changed from %s to %s.', old.status, new.status),
      old.status,
      new.status
    );
  end if;
  return null;
end;
$$;

create trigger ops_incidents_log_status_change
  after update on public.ops_incidents
  for each row execute function private.ops_incident_log_status_change();

-- ---------------------------------------------------------------------------
-- 6. Permission catalogue additions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  ('incidents.view',   'View incident register', 'Operations', 'Read the operations incident register across all categories'),
  ('incidents.manage', 'Manage incidents',       'Operations', 'Raise, own, update and close operations incidents')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. RLS
--    Reads: super admin, anyone holding incidents.view/manage, plus the
--    reporter and the owner of that specific incident (so a partner-facing
--    member who raised one can follow it without a broad read grant).
--    Writes: incidents.manage only. Nobody may DELETE — the register is the
--    audit trail; closing is a status, not a removal.
-- ---------------------------------------------------------------------------
alter table public.ops_incidents            enable row level security;
alter table public.ops_incident_updates     enable row level security;
alter table public.ops_incident_sla_targets enable row level security;

create or replace function private.can_view_ops_incidents()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or private.has_permission('incidents.view')
      or private.has_permission('incidents.manage');
$$;

create policy ops_incidents_select on public.ops_incidents
  for select to authenticated
  using (
    private.can_view_ops_incidents()
    or reported_by = (select auth.uid())
    or owner_id = (select auth.uid())
  );

create policy ops_incidents_insert on public.ops_incidents
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('incidents.manage'));

create policy ops_incidents_update on public.ops_incidents
  for update to authenticated
  using (private.is_admin() or private.has_permission('incidents.manage'))
  with check (private.is_admin() or private.has_permission('incidents.manage'));

create policy ops_incident_updates_select on public.ops_incident_updates
  for select to authenticated
  using (
    exists (
      select 1 from public.ops_incidents i
      where i.id = incident_id
        and (
          private.can_view_ops_incidents()
          or i.reported_by = (select auth.uid())
          or i.owner_id = (select auth.uid())
        )
    )
  );

create policy ops_incident_updates_insert on public.ops_incident_updates
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('incidents.manage'));

create policy ops_incident_sla_targets_select on public.ops_incident_sla_targets
  for select to authenticated using (true);

create policy ops_incident_sla_targets_update on public.ops_incident_sla_targets
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- RLS restricts rows; it does not grant table access. A table added by a
-- plain migration needs its own grant (this has silently broken access on
-- this project three separate times).
grant select, insert, update on public.ops_incidents        to authenticated;
grant select, insert         on public.ops_incident_updates to authenticated;
grant select, update         on public.ops_incident_sla_targets to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Assertions — "it works" should be provable from the migration itself.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.ops_incident_sla_targets;
  if v_count <> 4 then
    raise exception 'Expected an SLA target for all 4 severities, found %', v_count;
  end if;

  -- Every severity enum member must have a target, or inserts fail at runtime.
  select count(*) into v_count
  from unnest(enum_range(null::public.ops_incident_severity)) s
  where not exists (
    select 1 from public.ops_incident_sla_targets t where t.severity = s
  );
  if v_count <> 0 then
    raise exception '% severity levels have no SLA target', v_count;
  end if;

  if not exists (select 1 from public.permissions where key = 'incidents.manage') then
    raise exception 'incidents.manage was not seeded into the permission catalogue';
  end if;
end;
$$;
