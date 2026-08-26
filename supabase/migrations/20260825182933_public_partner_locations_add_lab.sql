-- Extends public.public_partner_locations() (public_partner_locations.sql)
-- with a third source: lab_providers. Same posture, same minimal-but-
-- identifying column set, same is_active + non-null address/lat/long filter.
-- Still never touches public.facilities — see lab_providers_location.sql.
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
  select id, name, 'lab'::text as type, address, latitude, longitude, regions
  from public.lab_providers
  where is_active = true
    and address is not null
    and latitude is not null
    and longitude is not null
  order by name;
$$;

-- Grants already applied to this function (public_partner_locations.sql) —
-- create or replace preserves them, but re-assert to be certain rather than
-- assume, per the standing anon-execute-gotcha rule (re-check live, don't
-- trust a comment).
do $$
begin
  if not has_function_privilege('anon', 'public.public_partner_locations()', 'EXECUTE') then
    raise exception 'anon must be able to read the public partner-location map';
  end if;
  if not has_function_privilege('authenticated', 'public.public_partner_locations()', 'EXECUTE') then
    raise exception 'authenticated must be able to read the public partner-location map';
  end if;
end $$;
