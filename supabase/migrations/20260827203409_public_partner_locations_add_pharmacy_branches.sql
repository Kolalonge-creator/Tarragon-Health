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
  union all
  select
    loc.id,
    pp.name || ' — ' || loc.name as name,
    'pharmacy'::text as type,
    loc.address,
    loc.latitude,
    loc.longitude,
    array[loc.state] as regions
  from public.pharmacy_partner_locations loc
  join public.pharmacy_partners pp on pp.id = loc.pharmacy_partner_id
  where loc.is_active = true
    and pp.is_active = true
    and loc.address is not null
    and loc.latitude is not null
    and loc.longitude is not null
  order by name;
$$;

do $$
begin
  if not has_function_privilege('anon', 'public.public_partner_locations()', 'EXECUTE') then
    raise exception 'anon must be able to read the public partner-location map';
  end if;
  if not has_function_privilege('authenticated', 'public.public_partner_locations()', 'EXECUTE') then
    raise exception 'authenticated must be able to read the public partner-location map';
  end if;
end $$;
