-- Tarragon Health — facilities: area granularity + commercial-provider link
--
-- Two additions let public.facilities become the single patient-facing location layer
-- for booking, without duplicating the commission/pricing model:
--
--   1. `area` — optional neighbourhood/LGA, the third tier below state/city that the
--      "choose a facility near me" pickers filter on. Nullable; a facility seeded with
--      only state+city still shows up (area filter is optional, same low-tech-on-purpose
--      shape as the rest of this table).
--
--   2. `lab_provider_id` / `pharmacy_partner_id` — a facility (the physical WHERE) can be
--      linked to the commercial partner that actually bills and earns commission (the
--      WHO). Commissions/pricing are keyed to lab_providers/pharmacy_partners via triggers
--      (20260715115451_commission_dashboard.sql), NOT to facilities — so a lab-test
--      booking derives its provider_id from the chosen facility's link and every existing
--      commission/origin-guard trigger keeps firing unchanged. Nullable: a facility with
--      no link (e.g. a hospital or vaccination centre) still works via the non-
--      transactional booking_requests path exactly as before.
--
-- on delete set null (not cascade): retiring a provider row must not delete the physical
-- facility listing — it just unlinks it (the facility falls back to booking-request-only).
--
-- facilities' existing RLS (authenticated read, admin write) is unchanged — additive
-- nullable columns inherit it.

alter table public.facilities
  add column if not exists area                text,
  add column if not exists lab_provider_id     uuid references public.lab_providers (id) on delete set null,
  add column if not exists pharmacy_partner_id uuid references public.pharmacy_partners (id) on delete set null;

comment on column public.facilities.area is 'Optional neighbourhood/LGA below city (e.g. "Ikeja GRA"); narrows the location pickers. Nullable.';
comment on column public.facilities.lab_provider_id is 'Optional link to the lab_providers row that runs this facility — the transactional lab booking derives its provider_id (pricing/commission) from here. Nullable; unlinked facilities are booking-request-only.';
comment on column public.facilities.pharmacy_partner_id is 'Optional link to the pharmacy_partners row that runs this facility. Nullable; same fallback as lab_provider_id.';

-- Discovery/pick queries filter type + location; partial index on active rows only,
-- mirroring facilities_verified_idx's `where` shape.
create index if not exists facilities_type_location_idx
  on public.facilities (type, state, city, area)
  where is_active;

create index if not exists facilities_lab_provider_idx
  on public.facilities (lab_provider_id)
  where lab_provider_id is not null;

create index if not exists facilities_pharmacy_partner_idx
  on public.facilities (pharmacy_partner_id)
  where pharmacy_partner_id is not null;
