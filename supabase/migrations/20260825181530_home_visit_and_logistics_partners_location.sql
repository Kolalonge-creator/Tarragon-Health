-- Tarragon Health — address + geocoded location for home_visit_providers and
-- logistics_partners (public /coverage map, founder-approved partner-identity
-- exposure for these two Tarragon-contracted-partner tables only — NOT
-- public.facilities, the self-arranged lab/pharmacy directory suspended
-- 2026-08-03, which stays untouched and out of scope).
--
-- Same additive-nullable-columns + range-check-constraint pattern as
-- pharmacy_partners.latitude/longitude (20260716120000_pharmacy_partners_
-- contact_location.sql) — reused verbatim rather than inventing a new one.
-- Nullable by design: an admin can activate a partner row before it is
-- geocoded, and public.public_partner_locations() (next migration) simply
-- skips any row missing address/latitude/longitude — no crash, no
-- placeholder pin.
--
-- No new grant statement needed: both tables already carry
-- `grant select/insert/update/delete ... to authenticated` from
-- 20260715230120_home_visit_and_logistics_partners.sql, and additive
-- nullable columns inherit that unchanged (same note as the pharmacy_partners
-- migration this pattern is copied from).

alter table public.home_visit_providers
  add column if not exists address    text,
  add column if not exists latitude   double precision,
  add column if not exists longitude  double precision;

alter table public.logistics_partners
  add column if not exists address    text,
  add column if not exists latitude   double precision,
  add column if not exists longitude  double precision;

-- Constraints guarded for idempotent re-apply (Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS), identical shape to
-- pharmacy_partners_latitude_range / pharmacy_partners_longitude_range.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'home_visit_providers_latitude_range') then
    alter table public.home_visit_providers add constraint home_visit_providers_latitude_range
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'home_visit_providers_longitude_range') then
    alter table public.home_visit_providers add constraint home_visit_providers_longitude_range
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'logistics_partners_latitude_range') then
    alter table public.logistics_partners add constraint logistics_partners_latitude_range
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'logistics_partners_longitude_range') then
    alter table public.logistics_partners add constraint logistics_partners_longitude_range
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end $$;
