-- Tarragon Health — module 28, part 2: locations, departments, service
-- catalogue, resources and operating hours (28.3/28.5/28.6/28.7).
--
-- All four scope through organisation_id (the multi-tenancy invariant) and
-- are gated by private.is_provider_org_staff_for(), which already carries
-- the module + is_operational double gate — nothing new to prove about
-- dormancy here, only that structure itself is correct.

create table public.provider_org_locations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  name              text not null,
  is_headquarters   boolean not null default false,
  address           text,
  state             text,
  city              text,
  contact_phone     text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint provider_org_locations_phone_e164
    check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$')
);

comment on table public.provider_org_locations is
  '28.3. Multi-location support: "Hospital Group / Lagos / Main hospital, Clinic A, Diagnostic Centre / Abuja / Hospital, Clinic". One organisation, many locations, each independently schedulable via provider_org_resources.location_id below.';

create index provider_org_locations_org_idx on public.provider_org_locations (organisation_id) where is_active;

create trigger provider_org_locations_set_updated_at
  before update on public.provider_org_locations
  for each row execute function private.set_updated_at();

create table public.provider_org_departments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  location_id       uuid references public.provider_org_locations (id) on delete set null,
  name              text not null,
  department_type   text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.provider_org_departments.location_id is
  'Null means the department spans every location (e.g. a single Finance department for a multi-site hospital group) rather than being tied to one site.';

create index provider_org_departments_org_idx on public.provider_org_departments (organisation_id) where is_active;

create trigger provider_org_departments_set_updated_at
  before update on public.provider_org_departments
  for each row execute function private.set_updated_at();

-- provider_org_members gains optional location/department attachment, added
-- here rather than in the previous migration since both tables now exist.
alter table public.provider_org_members
  add column location_id   uuid references public.provider_org_locations (id) on delete set null,
  add column department_id uuid references public.provider_org_departments (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Service catalogue (28.5).
-- ---------------------------------------------------------------------------
create table public.provider_org_services (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  location_id       uuid references public.provider_org_locations (id) on delete cascade,
  name              text not null,
  description       text,
  duration_minutes  integer check (duration_minutes is null or duration_minutes > 0),
  price_kobo        bigint check (price_kobo is null or price_kobo >= 0),
  provider_type     text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.provider_org_services is
  '28.5: service, description, duration, price, provider type, location, availability. "Availability" itself is provider_org_resources/provider_org_operating_hours below, not a column here — a service names what is offered, resources+hours say when.';

create index provider_org_services_org_idx on public.provider_org_services (organisation_id) where is_active;
create index provider_org_services_location_idx on public.provider_org_services (location_id) where is_active;

create trigger provider_org_services_set_updated_at
  before update on public.provider_org_services
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Resources — rooms/equipment (28.6/28.7). Deliberately configuration only,
-- same posture as clinical_resources (20260828001916): no real-time booking
-- transaction table, because a provider organisation's own bookings are out
-- of scope here (see the previous migration's header) — this records WHAT
-- a room/machine is and its operating window, which is enough for 28.7's own
-- examples ("MRI machine -> Available -> Bookable diagnostic slots",
-- "Consultation Room 3 -> Cardiology -> 09:00-16:00") to be represented and
-- shown, without inventing a parallel appointment engine to book against it.
-- ---------------------------------------------------------------------------
create table public.provider_org_resources (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  location_id       uuid references public.provider_org_locations (id) on delete set null,
  department_id     uuid references public.provider_org_departments (id) on delete set null,
  resource_type     public.provider_org_resource_type not null,
  name              text not null,
  description       text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index provider_org_resources_org_idx on public.provider_org_resources (organisation_id) where is_active;

create trigger provider_org_resources_set_updated_at
  before update on public.provider_org_resources
  for each row execute function private.set_updated_at();

create table public.provider_org_operating_hours (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  location_id       uuid references public.provider_org_locations (id) on delete cascade,
  resource_id       uuid references public.provider_org_resources (id) on delete cascade,
  day_of_week       integer not null check (day_of_week between 0 and 6),
  opens_at          time not null,
  closes_at         time not null,
  created_at        timestamptz not null default now(),
  constraint provider_org_operating_hours_time_valid check (closes_at > opens_at),
  -- Exactly one scope per row: a location's general hours, or one
  -- resource's own narrower window (e.g. Consultation Room 3, Mon-Fri
  -- 09:00-16:00 inside a location open longer than that).
  constraint provider_org_operating_hours_one_scope
    check ((location_id is not null) <> (resource_id is not null))
);

comment on table public.provider_org_operating_hours is
  '28.6/28.7 operating hours, at location granularity or narrowed to one resource. Configuration only — nothing here reserves a slot; a future booking feature would consult it, not this migration.';

create index provider_org_operating_hours_location_idx on public.provider_org_operating_hours (location_id);
create index provider_org_operating_hours_resource_idx on public.provider_org_operating_hours (resource_id);

-- ---------------------------------------------------------------------------
-- RLS — one shared shape across all four tables.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'provider_org_locations', 'provider_org_departments',
    'provider_org_services', 'provider_org_resources', 'provider_org_operating_hours'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated using (private.is_admin() or private.is_provider_org_staff_for(organisation_id));
      create policy %1$s_manage on public.%1$I
        for all to authenticated
        using (private.is_admin() or private.is_provider_org_staff_for(organisation_id, array['owner', 'operations_manager']::public.provider_org_role[]))
        with check (private.is_admin() or private.is_provider_org_staff_for(organisation_id, array['owner', 'operations_manager']::public.provider_org_role[]));
    $f$, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'provider_org_locations', 'provider_org_departments',
    'provider_org_services', 'provider_org_resources', 'provider_org_operating_hours'
  ]
  loop
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'FAIL: authenticated has no SELECT on %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then
      raise exception 'FAIL: anon can read %', t;
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = t) < 2 then
      raise exception 'FAIL: % is missing its select/manage policies', t;
    end if;
  end loop;

  -- The one-scope CHECK on operating hours discriminates: neither both nor
  -- neither of location_id/resource_id may be set.
  begin
    insert into public.provider_org_operating_hours (organisation_id, day_of_week, opens_at, closes_at)
    values ('00000000-0000-0000-0000-000000000000', 1, '09:00', '16:00');
    raise exception 'FAIL: operating_hours accepted a row with neither location_id nor resource_id';
  exception
    when check_violation then null;
  end;

  raise notice 'PASS: locations/departments/services/resources/hours in place with matching RLS, one-scope check proved to discriminate';
end $$;
