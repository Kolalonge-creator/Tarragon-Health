-- Tarragon Health — address + geocoded location for lab_providers, extending
-- the public /coverage partner map (see home_visit_and_logistics_partners_
-- location.sql, public_partner_locations.sql) to the third genuinely
-- Tarragon-contracted partner catalogue.
--
-- Deliberately NOT touching public.facilities — the separate self-arranged
-- lab/pharmacy directory, still suspended (facilities_suspended_pending_
-- accreditation, 2026-08-03). A lab_providers row like Synlab Nigeria
-- (is_active = true, real billing wired via the 2026-08-21 partner-billing
-- migrations) is a genuine contracted partner, not a self-arranged listing —
-- same category as home_visit_providers/logistics_partners, unlike
-- facilities. Branch-level addresses for a lab do already exist via the
-- facilities<->lab_provider_id link (see admin-lab-facilities.tsx), but
-- reusing that table here would mean the partner map's RPC reads from the
-- same table that's platform-wide suspended for a different reason — kept
-- deliberately separate instead, same additive-nullable-columns pattern as
-- pharmacy_partners.latitude/longitude and the other two partner tables.
alter table public.lab_providers
  add column if not exists address    text,
  add column if not exists latitude   double precision,
  add column if not exists longitude  double precision;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lab_providers_latitude_range') then
    alter table public.lab_providers add constraint lab_providers_latitude_range
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lab_providers_longitude_range') then
    alter table public.lab_providers add constraint lab_providers_longitude_range
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end $$;
