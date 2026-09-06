-- Tarragon Health — public partner-location map (marketing /coverage page)
--
-- Founder-approved, scoped exception to the coverage page's "no partner
-- identities exposed" principle: ONLY for home_visit_providers and
-- logistics_partners (Tarragon's own contracted logistics partners), never
-- for public.facilities (self-arranged lab/pharmacy directory, suspended
-- 2026-08-03, deliberately out of scope and untouched here).
--
-- Mirrors public_service_coverage()'s security posture (language sql stable
-- security definer set search_path to '', anon+authenticated EXECUTE granted
-- explicitly after revoking the implicit PUBLIC grant) but, unlike that
-- function, deliberately returns identifying rows — that identity exposure is
-- the whole point of this feature, per the founder's explicit approval.
--
-- Output is minimal-but-identifying: id, name, a 'home_visit'|'delivery' type
-- discriminator, address, latitude, longitude, regions. Never
-- home_visit_fee_kobo, delivery_fee_kobo, estimated_delivery_hours,
-- license_number, license_type, license_expires_at, license_verified_by/at,
-- or any other internal/commercial/regulatory field — those stay behind
-- authenticated-only RLS, untouched by this function.
--
-- Only rows where is_active = true AND address/latitude/longitude are all
-- non-null are returned, so an active partner with no geocoded address yet
-- simply produces no pin — no crash, no placeholder marker, no partial row.
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
  order by name;
$$;

-- Deliberately anon-callable: this is what powers the public /coverage map.
--
-- Same gotcha as public_service_coverage(): a freshly created function
-- carries a PUBLIC pseudo-role EXECUTE grant, and anon inherits from PUBLIC
-- rather than holding a grant of its own, so `revoke ... from public` (not
-- `from anon`) is what actually clears the blanket grant before re-granting
-- explicitly by name.
revoke all on function public.public_partner_locations() from public, anon;
grant execute on function public.public_partner_locations() to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.public_partner_locations()', 'EXECUTE') then
    raise exception 'anon must be able to read the public partner-location map';
  end if;
  if not has_function_privilege('authenticated', 'public.public_partner_locations()', 'EXECUTE') then
    raise exception 'authenticated must be able to read the public partner-location map';
  end if;
end $$;
