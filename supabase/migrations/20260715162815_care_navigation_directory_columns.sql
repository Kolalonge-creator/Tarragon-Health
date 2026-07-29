-- Tarragon Health
-- Care Navigation directory (docs/FULL_SPECIFICATION_V4.md §2.3/§5 —
-- "Care Navigation directory: a patient-facing 'find near me' view (labs,
-- pharmacies, vaccination centres, specialists) with maps, distinct from
-- the transactional booking flow that already exists").
--
-- The spec's own §5 table proposes a new `care_navigation_directory` table
-- (organisation_id, lat, lng, hours, services_offered, verified), but that
-- would duplicate the existing `public.facilities` table (name, type, state,
-- city, contact info, is_active — see 20260706084934_facilities_booking_requests.sql),
-- which is already the curated, admin-maintained directory the patient-facing
-- discovery view should read from. Building a second table would be exactly
-- the "dual source of truth" pattern this codebase deliberately avoids
-- elsewhere (see CLAUDE.md's wearable_readings vs vitals_readings rule) —
-- so this adds the spec's missing discovery-layer columns onto `facilities`
-- instead of creating a parallel table. `services_offered` is also skipped
-- here: `facility_services` already models that relationally (name,
-- description, price_kobo per facility), which is strictly better than a
-- flat text[] duplicate.

alter table public.facilities
  add column latitude numeric,
  add column longitude numeric,
  add column hours text,
  add column verified boolean not null default false;

comment on column public.facilities.latitude is 'Nullable — many facilities are seeded without coordinates yet; the discovery view falls back to state/city text search when absent.';
comment on column public.facilities.longitude is 'Nullable, paired with latitude.';
comment on column public.facilities.hours is 'Free-text opening hours (e.g. "Mon-Sat 8am-6pm"), not structured — matches the low-tech-on-purpose shape of the rest of this table.';
comment on column public.facilities.verified is 'Admin-confirmed as a real, current, working listing — distinct from is_active (which just controls visibility). Defaults false; the patient-facing directory surfaces this as a trust badge, per the spec''s "verified" field.';

create index facilities_verified_idx on public.facilities (verified) where verified = true;
