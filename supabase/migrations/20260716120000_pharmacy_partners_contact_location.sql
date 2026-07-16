-- Tarragon Health — pharmacy partner contact + location (medication pathway, Phase 0)
--
-- Two capabilities depend on this:
--   1. "Nearest pharmacy" selection — patients pick where to collect, so each
--      partner needs a geocoded location (latitude/longitude + human address).
--   2. No-login pharmacy fulfilment — not every partner pharmacy will adopt the
--      dashboard, so an order must be able to reach them by SMS + email. That
--      needs a contact phone (E.164, same convention as profiles.phone) and a
--      contact email on the partner record.
--
-- NOTE (2026-07-16 reconciliation): a parallel workstream shipped a shared
-- state/city/area location model on pharmacy_partners (see
-- 20260716161000_facilities_area_provider_link.sql + the facility-selector),
-- which is the model the pharmacy UI now uses for "nearest". The
-- latitude/longitude/address columns below are therefore redundant with that
-- model and left unused by the UI; they are kept here only because this exact
-- migration was already applied to the remote DB before the two efforts were
-- reconciled. A follow-up migration may drop them once coordinated — do not
-- silently diverge this file from the applied remote schema.
--
-- `uses_platform_login` marks the partners that DO log in (Phase 8 pharmacist
-- surface) vs. the notification-only majority — both paths coexist; this flag
-- just drives whether the order-notification layer is their only channel.
--
-- pharmacy_partners is global reference data (authenticated read via the
-- existing `using (true)` select policy, admin-only write) — these additive
-- nullable columns inherit that policy unchanged. Business contact details, not
-- patient PII, so authenticated read is acceptable.

alter table public.pharmacy_partners
  add column if not exists contact_phone        text,
  add column if not exists contact_email        text,
  add column if not exists address              text,
  add column if not exists latitude             double precision,
  add column if not exists longitude            double precision,
  add column if not exists uses_platform_login  boolean not null default false;

-- Constraints guarded for idempotent re-apply (Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS). E.164 shape matches profiles.phone; email is
-- a light sanity check only; lat/long must be a sane coordinate pair.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pharmacy_partners_contact_phone_e164') then
    alter table public.pharmacy_partners add constraint pharmacy_partners_contact_phone_e164
      check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pharmacy_partners_contact_email_shape') then
    alter table public.pharmacy_partners add constraint pharmacy_partners_contact_email_shape
      check (contact_email is null or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pharmacy_partners_latitude_range') then
    alter table public.pharmacy_partners add constraint pharmacy_partners_latitude_range
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pharmacy_partners_longitude_range') then
    alter table public.pharmacy_partners add constraint pharmacy_partners_longitude_range
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end $$;
