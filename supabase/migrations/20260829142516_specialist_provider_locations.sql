-- Tarragon Health
-- Specialist Network & Provider Platform — multi-location support for
-- specialist_providers (66.2 "locations", plural). Mirrors
-- lab_provider_locations.sql's shape (one row per physical branch, same RLS
-- posture, same phone/lat/long constraint patterns) rather than inventing a
-- new pattern — a contracted specialist can practise from more than one
-- clinic/hospital, same reasoning as a lab chain having multiple branches.
--
-- Unlike lab_provider_locations, the existing single location/state/city
-- columns on specialist_providers are kept, not dropped: they're read
-- directly by useMatchedSpecialistProviders/ChooseReferralSpecialist today
-- and migrating every read path to this table is a separate, larger change
-- than this migration's scope. This table is additive — a provider with no
-- rows here still works exactly as before via its existing columns.
--
-- Each location also carries its own telemedicine/in-person support flags,
-- since a specialist may offer telemedicine platform-wide but only see
-- physical patients at one of several branches.
create table public.specialist_provider_locations (
  id                        uuid primary key default gen_random_uuid(),
  specialist_provider_id    uuid not null references public.specialist_providers (id) on delete cascade,
  name                      text not null,
  state                     text not null,
  city                      text,
  address                   text not null,
  contact_phone             text,
  latitude                  double precision,
  longitude                 double precision,
  supports_telemedicine     boolean not null default false,
  supports_in_person        boolean not null default true,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  constraint specialist_provider_locations_contact_phone_e164
    check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint specialist_provider_locations_latitude_range
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint specialist_provider_locations_longitude_range
    check (longitude is null or (longitude >= -180 and longitude <= 180))
);

create index specialist_provider_locations_provider_idx
  on public.specialist_provider_locations (specialist_provider_id);

alter table public.specialist_provider_locations enable row level security;

create policy specialist_provider_locations_select on public.specialist_provider_locations
  for select to authenticated using (true);
create policy specialist_provider_locations_insert on public.specialist_provider_locations
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('partners.specialists.manage'));
create policy specialist_provider_locations_update on public.specialist_provider_locations
  for update to authenticated
  using (private.is_admin() or private.has_permission('partners.specialists.manage'))
  with check (private.is_admin() or private.has_permission('partners.specialists.manage'));
create policy specialist_provider_locations_delete on public.specialist_provider_locations
  for delete to authenticated
  using (private.is_admin() or private.has_permission('partners.specialists.manage'));

-- Freshly created table needs its own explicit grant — RLS restricts rows,
-- it does not grant table-level access (the standing gotcha, see
-- reference_authenticated_table_grants_root_cause.md).
grant select, insert, update, delete on public.specialist_provider_locations to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.specialist_provider_locations', 'SELECT') then
    raise exception 'authenticated must be able to read specialist_provider_locations';
  end if;
  if not has_table_privilege('authenticated', 'public.specialist_provider_locations', 'INSERT') then
    raise exception 'authenticated must be able to insert specialist_provider_locations';
  end if;
end $$;
