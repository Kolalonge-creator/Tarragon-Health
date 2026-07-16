-- Tarragon Health — structured location on the partner-keyed catalogues
--
-- pharmacy_partners and specialist_providers are intrinsically partner-keyed (a
-- pharmacy's formulary belongs to a partner; a specialist is staff-assigned) — a parallel
-- facilities row for each would be a dual source of truth. So instead of forcing them
-- through facilities, they get the SAME state/city/area location model directly, and the
-- pickers filter on these columns:
--
--   • pharmacy_partners already carries address + latitude/longitude
--     (20260716120000_pharmacy_partners_contact_location.sql); this adds the structured
--     state/city/area the "nearest pharmacy" filter needs on top of the free geo point.
--
--   • specialist_providers already has `state`
--     (20260716103000_specialist_provider_matching_fields.sql); this adds city/area so the
--     staff-side specialist matching can narrow below state.
--
-- All nullable, no default — same discipline as the rest of this location work. Both
-- tables are global reference data (authenticated read, admin write); additive nullable
-- columns inherit those policies unchanged.

alter table public.pharmacy_partners
  add column if not exists state text,
  add column if not exists city  text,
  add column if not exists area  text;

comment on column public.pharmacy_partners.state is 'Free-text state (e.g. "Lagos") for the nearest-pharmacy location filter. Nullable.';
comment on column public.pharmacy_partners.city is 'Free-text city/town (e.g. "Ikeja"). Nullable.';
comment on column public.pharmacy_partners.area is 'Optional neighbourhood/LGA. Nullable.';

create index if not exists pharmacy_partners_location_idx
  on public.pharmacy_partners (state, city, area)
  where is_active;

alter table public.specialist_providers
  add column if not exists city text,
  add column if not exists area text;

comment on column public.specialist_providers.city is 'Free-text city/town, narrows specialist matching below state. Nullable.';
comment on column public.specialist_providers.area is 'Optional neighbourhood/LGA. Nullable.';

-- Extend the existing matching index (specialist_type, state, is_active) with city so a
-- same-locality match can be found without a full scan.
create index if not exists specialist_providers_location_idx
  on public.specialist_providers (specialist_type, state, city)
  where is_active;
