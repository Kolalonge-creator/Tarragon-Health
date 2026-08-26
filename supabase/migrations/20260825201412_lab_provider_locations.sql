-- Tarragon Health — branch-level locations for a contracted lab_providers row
--
-- Supersedes the single address/latitude/longitude columns added to
-- lab_providers earlier this session (lab_providers_location.sql):
-- a real contracted lab chain like Synlab Nigeria has dozens of physical
-- branches, not one address, so a one-row-per-provider address field can't
-- represent it. This is a proper child table instead — one row per branch.
--
-- Deliberately a NEW table, not a reactivation of public.facilities: the
-- founder's 2026-08-03 decision to suspend every facilities row was explicit
-- that there is "no carve-out" (see suspend_all_facilities_and_vaccination_
-- booking.sql) even for a partner that later gets contracted. This table is
-- scoped only to genuinely contracted lab_providers rows and never touches
-- facilities.
--
-- Same RLS posture as lab_providers itself (authenticated read,
-- admin-or-partners.labs.manage write) and the same phone/lat/long
-- constraint patterns already used elsewhere (pharmacy_partners_contact_
-- location.sql).
create table public.lab_provider_locations (
  id               uuid primary key default gen_random_uuid(),
  lab_provider_id  uuid not null references public.lab_providers (id) on delete cascade,
  name             text not null,
  state            text not null,
  address          text not null,
  contact_phone    text,
  latitude         double precision,
  longitude        double precision,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint lab_provider_locations_contact_phone_e164
    check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint lab_provider_locations_latitude_range
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint lab_provider_locations_longitude_range
    check (longitude is null or (longitude >= -180 and longitude <= 180))
);

create index lab_provider_locations_provider_idx on public.lab_provider_locations (lab_provider_id);

alter table public.lab_provider_locations enable row level security;

create policy lab_provider_locations_select on public.lab_provider_locations
  for select to authenticated using (true);
create policy lab_provider_locations_insert on public.lab_provider_locations
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('partners.labs.manage'));
create policy lab_provider_locations_update on public.lab_provider_locations
  for update to authenticated
  using (private.is_admin() or private.has_permission('partners.labs.manage'))
  with check (private.is_admin() or private.has_permission('partners.labs.manage'));
create policy lab_provider_locations_delete on public.lab_provider_locations
  for delete to authenticated
  using (private.is_admin() or private.has_permission('partners.labs.manage'));

-- Freshly created table needs its own explicit grant — RLS restricts rows, it
-- does not grant table-level access (the standing "why migration-created
-- tables were unreachable" gotcha).
grant select, insert, update, delete on public.lab_provider_locations to authenticated;

-- Drop the now-superseded singular columns on lab_providers — unused by any
-- committed code path (added and replaced within the same session), so no
-- migration-ordering hazard.
alter table public.lab_providers
  drop constraint if exists lab_providers_latitude_range,
  drop constraint if exists lab_providers_longitude_range,
  drop column if exists address,
  drop column if exists latitude,
  drop column if exists longitude;

do $$
begin
  if not has_table_privilege('authenticated', 'public.lab_provider_locations', 'SELECT') then
    raise exception 'authenticated must be able to read lab_provider_locations';
  end if;
  if not has_table_privilege('authenticated', 'public.lab_provider_locations', 'INSERT') then
    raise exception 'authenticated must be able to insert lab_provider_locations';
  end if;
end $$;
