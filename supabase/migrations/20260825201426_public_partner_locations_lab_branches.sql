-- Extends public.public_partner_locations() again: the 'lab' source now
-- reads per-branch rows from public.lab_provider_locations (joined to
-- lab_providers for the is_active gate and display name) instead of a single
-- address column directly on lab_providers — see lab_provider_locations.sql
-- for why the schema changed. home_visit/delivery sources are unchanged.
--
-- name is composed as "<provider name> — <branch name>" so a pin/InfoWindow
-- is never a bare, out-of-context label like "Wuse II" with no indication of
-- which company it belongs to.
create or replace function public.public_partner_locations()
returns table (
  id uuid,
  name text,
  type text,
  address text,
  latitude double precision,
  longitude double precision,
  regions text[]
)
language sql
stable
security definer
set search_path to ''
as $$
  select id, name, 'home_visit'::text as type, address, latitude, longitude, regions
  from public.home_visit_providers
  where is_active = true
    and address is not null
    and latitude is not null
    and longitude is not null
  union all
  select id, name, 'delivery'::text as type, address, latitude, longitude, regions
  from public.logistics_partners
  where is_active = true
    and address is not null
    and latitude is not null
    and longitude is not null
  union all
  select
    loc.id,
    lp.name || ' — ' || loc.name as name,
    'lab'::text as type,
    loc.address,
    loc.latitude,
    loc.longitude,
    array[loc.state] as regions
  from public.lab_provider_locations loc
  join public.lab_providers lp on lp.id = loc.lab_provider_id
  where loc.is_active = true
    and lp.is_active = true
    and loc.address is not null
    and loc.latitude is not null
    and loc.longitude is not null
  order by name;
$$;

-- Grants already applied to this function (public_partner_locations.sql) —
-- create or replace preserves them, but re-assert to be certain, per the
-- standing anon-execute-gotcha rule.
do $$
begin
  if not has_function_privilege('anon', 'public.public_partner_locations()', 'EXECUTE') then
    raise exception 'anon must be able to read the public partner-location map';
  end if;
  if not has_function_privilege('authenticated', 'public.public_partner_locations()', 'EXECUTE') then
    raise exception 'authenticated must be able to read the public partner-location map';
  end if;
end $$;
