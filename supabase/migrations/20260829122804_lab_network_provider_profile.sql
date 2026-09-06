-- Tarragon Health — Laboratory Network & Diagnostic Services Platform, part 1:
-- laboratory organisation profile fields (spec §56.2, §56.3, §56.12).
--
-- FOUNDER DECISION 2026-08-29: Tarragon returns to routing and billing labs
-- directly, generalised beyond the single-partner (Synlab) shape the
-- 2026-08-03 self-arranged-fulfilment correction left behind. This reopens
-- what that correction closed — see the CLAUDE.md rewrite landing alongside
-- this migration series for the full reasoning and the archive entry that
-- documents it. What does NOT change: every discipline the Synlab build-out
-- earned the hard way stays load-bearing — a laboratory cannot go
-- is_active=true carrying placeholder contact details
-- (lab_providers_active_needs_real_contacts, unchanged, still enforced), a
-- test cannot be sold below what the lab charges Tarragon for it
-- (assert_test_price_covers_cost, unchanged), and the three still-placeholder
-- providers (Cerba Lancet, Healthtracka, Afriglobal Medicare) stay is_active
-- = false — this migration does not fabricate a contract for them. What it
-- does is remove the part of the model that assumed there would only ever be
-- one active laboratory: private.resolve_lab_order_provider
-- (20260821191942) already resolves an explicitly-named provider or
-- facility, and public.region_service_available (20260717101000) already
-- uses `exists (...)` rather than "exactly one" for lab coverage — neither
-- needs to change. The only standing "exactly one" assertion was a one-time
-- DO block inside 20260821193144_switch_on_synlab.sql's own migration run,
-- not a live constraint, so there is nothing to relax there either. This
-- migration is additive schema: the descriptive profile fields a real
-- multi-lab network needs that a single contracted partner never surfaced a
-- need for.

-- ---------------------------------------------------------------------------
-- 1. Integration status (§56.12) — how this laboratory exchanges orders and
-- results with Tarragon today. Informational, not a booking gate: is_active
-- stays the sole hard gate (whether Tarragon may bill and route to this
-- laboratory at all), exactly as it already is. A laboratory can be
-- is_active and still 'manual' — that is Synlab's own real state today (see
-- switch_on_synlab.sql's own comment: "Transmission today is a person
-- sending the request ... not an automated email"). Ready for a real
-- HL7/FHIR or API partner the same "credential-drop-in-ready, not live"
-- way the wearables integration was built — no fabricated connector, a real
-- field to record the truth once one exists.
-- ---------------------------------------------------------------------------
create type public.lab_integration_status as enum (
  'api', 'hl7_fhir', 'file_exchange', 'structured_upload', 'manual'
);

comment on type public.lab_integration_status is
  'How a lab_providers row exchanges orders/results with Tarragon. manual = a person keys in a reference number (Synlab today, mark_lab_order_transmitted). structured_upload = the existing AI-extraction result-upload pipeline (lab_result_documents). api/hl7_fhir/file_exchange are schema-ready for a real integration; none is live yet — see docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md before assuming otherwise.';

alter table public.lab_providers
  add column if not exists integration_status public.lab_integration_status not null default 'manual',
  add column if not exists accreditation      text,
  add column if not exists status_notes       text;

comment on column public.lab_providers.accreditation is
  'Free-text accreditation/quality information (e.g. "ISO 15189:2022, MLSCN-licensed"), shown on the patient-facing provider profile where present. Null means not recorded, not "unaccredited" — never render an absence as a negative claim.';
comment on column public.lab_providers.status_notes is
  'Admin-facing context for why a laboratory is is_active=false right now (onboarding, paused, contract lapsed) — never shown to a patient. Purely descriptive; is_active is still the only thing any trigger or RLS policy reads.';

update public.lab_providers
   set status_notes = 'Seeded placeholder — no signed contract yet. See lab_providers_active_needs_real_contacts.'
 where status_notes is null and not is_active
   and (coalesce(contact_email, '') like '%.example%' or contact_email is null);

-- ---------------------------------------------------------------------------
-- 2. Branch-level opening hours and capabilities (§56.2, §56.3 — "each
-- location can have different capabilities").
-- ---------------------------------------------------------------------------
alter table public.lab_provider_locations
  add column if not exists opening_hours jsonb,
  add column if not exists capabilities  text[] not null default '{}';

comment on column public.lab_provider_locations.opening_hours is
  'Per-day open/close times, e.g. {"mon":{"open":"08:00","close":"18:00"},"sun":null}. Null (the default) means hours are not yet recorded, not that the branch is closed every day — the booking UI must not infer availability from an absent value.';
comment on column public.lab_provider_locations.capabilities is
  'What this specific branch can do, distinct from what the provider offers nationally via lab_tests — e.g. walk_in, home_collection_hub, stat_processing. Empty array (the default) means not yet recorded, not "no capabilities" — same non-inference rule as opening_hours.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_providers' and column_name = 'integration_status'
  ) then
    raise exception 'lab_providers.integration_status was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_provider_locations' and column_name = 'opening_hours'
  ) then
    raise exception 'lab_provider_locations.opening_hours was not created';
  end if;
  -- The safety discipline from the Synlab build-out must survive this
  -- migration untouched — this is additive schema, not a loosening.
  if not exists (
    select 1 from pg_constraint
    where conname = 'lab_providers_active_needs_real_contacts'
      and conrelid = 'public.lab_providers'::regclass
  ) then
    raise exception 'lab_providers_active_needs_real_contacts was dropped — the placeholder-contact guard must survive the network generalisation';
  end if;
  if (select count(*) from public.lab_providers where is_active) <> 1 then
    raise exception 'expected exactly Synlab to still be the only real contracted (is_active) laboratory at the end of this migration — no contract was fabricated for the other three';
  end if;
end $$;
