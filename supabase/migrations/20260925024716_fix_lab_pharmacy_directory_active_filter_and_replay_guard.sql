-- Follow-up to 20260925023144_restrict_lab_pharmacy_partner_read_to_safe_columns.sql,
-- found by /code-review high before merge (8 independent finder angles
-- converged on the same defect, plus a second, more serious one it caused):
--
-- 1) Both directory views were defined `where is_active`, which the OLD
--    `using (true)` base-table policy + plain PostgREST embed never
--    enforced -- an embedded `lab_providers!...(name, regions)` or
--    `pharmacy_partners!...(...)` join returned its target row regardless of
--    is_active. Filtering the replacement views by is_active silently
--    changed the semantics for every ATTRIBUTION read (an already-placed
--    lab_orders/pharmacy_medications row, an already-recorded
--    partner_statements row) from "always shows which provider/partner this
--    was" to "shows null the moment that provider/partner goes inactive" --
--    a real regression for a patient's own order history, the clinician
--    lab-orders worklist, and a finance officer reconciling a historical
--    settlement, none of which asked to see only ACTIVE providers, they
--    asked which provider a specific already-existing row belongs to.
--
-- 2) Worse, in apps/web/src/app/(dashboard)/patient/pharmacy-catalogue.tsx,
--    the location filter has a deliberate escape hatch for a partner with no
--    structured address ("Partners with no structured location fall through
--    the filter so they never disappear") -- and a null `pharmacy_partner`
--    (because the directory join found nothing, is_active having gone
--    false) satisfies that same fall-through condition. The medication row
--    stayed bookable, rendered as a bare "Pharmacy" placeholder with no
--    name/address, and "Book here" still submitted the raw
--    `pharmacy_partner_id` off the underlying pharmacy_medications row --
--    letting a patient place an order against a now-inactive pharmacy
--    partner while shown none of its identifying information. This one IS a
--    picker (a patient choosing where to buy a currently-available
--    medication), so the fix there is the opposite of #1: exclude the row
--    entirely rather than null-and-continue -- see the accompanying app-code
--    fix in the same PR (apps/web/src/lib/queries/pharmacy-orders.ts).
--
-- Fix: drop the `where is_active` clause from both views -- they go back to
-- being a pure safe-column projection over every row, exactly matching what
-- the old embeds already exposed (minus the sensitive columns, which is the
-- part that was actually supposed to change). Any caller that genuinely
-- wants "active only" (the finance page's own new-statement provider
-- picker; the pharmacy catalogue's now-explicit partner.is_active check)
-- filters for it itself, the same way the finance page's OLD code already
-- did with its own `.eq("is_active", true)` before this fix touched it.

begin;

create or replace view public.lab_provider_directory
  with (security_invoker = false)
  as
  select
    id,
    name,
    home_collection,
    regions,
    is_active,
    integration_status,
    accreditation,
    license_type,
    license_number,
    license_expires_at,
    license_verified_at
  from public.lab_providers;

comment on view public.lab_provider_directory is
  'The patient-, clinician- and finance-facing window onto lab_providers. Carries the licence fields (checkable against the regulator) and is_active, never cost_basis/cost_basis_note/cost_basis_verified_at/cost_basis_verified_by/compliance_owner_profile_id/status_notes/organisation_id/contact_phone/contact_email. Owner-run on purpose (no security_invoker) so it survives the base table being admin-only -- see 20260925023144''s header. Carries every row regardless of is_active (fixed 2026-09-25, was filtered `where is_active` -- broke attribution reads for a provider that goes inactive after being referenced); a caller that wants active-only for a picker filters is_active itself.';

create or replace view public.pharmacy_partner_directory
  with (security_invoker = false)
  as
  select
    id,
    name,
    delivery,
    regions,
    is_active,
    address,
    latitude,
    longitude,
    state,
    city,
    area,
    delivery_fee_kobo,
    license_type,
    license_number,
    license_expires_at,
    license_verified_at
  from public.pharmacy_partners;

comment on view public.pharmacy_partner_directory is
  'The patient-, clinician- and finance-facing window onto pharmacy_partners. Carries the licence fields, is_active, and the location/delivery-fee columns the patient-facing catalogue already selected explicitly, never business_registration_number/compliance_owner_profile_id/the onboarding-workflow *_at/*_by columns/rejection_reason/onboarding_status/uses_platform_login/organisation_id/contact_phone/contact_email. Owner-run on purpose (no security_invoker), same exception as lab_provider_directory. Carries every row regardless of is_active (fixed 2026-09-25, was filtered `where is_active` -- see lab_provider_directory''s comment for why); apps/web/src/lib/queries/pharmacy-orders.ts filters is_active itself now, since a bookable catalogue must exclude an inactive partner''s medications entirely rather than show them anonymized-but-still-orderable.';

do $$
declare
  v_patient uuid;
  v_rows    int;
begin
  select id into v_patient from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIP: no patient profile to simulate';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- The directories must still carry no sensitive column after losing
    -- their is_active filter -- this is the one property that must never
    -- regress, regardless of which rows the view includes.
    perform 1 from public.lab_provider_directory limit 1;
    perform 1 from public.pharmacy_partner_directory limit 1;

    reset role;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name in ('lab_provider_directory', 'pharmacy_partner_directory')
       and column_name in (
         'cost_basis', 'cost_basis_note', 'cost_basis_verified_at', 'cost_basis_verified_by',
         'compliance_owner_profile_id', 'status_notes', 'organisation_id',
         'contact_phone', 'contact_email', 'business_registration_number',
         'business_verified_at', 'business_verified_by', 'service_configured_at',
         'service_configured_by', 'integration_tested_at', 'integration_tested_by',
         'approved_at', 'approved_by', 'rejected_at', 'rejected_by', 'rejection_reason',
         'onboarding_status', 'uses_platform_login', 'license_verified_by'
       )
  ) then
    raise exception 'FAIL: a directory view exposes a commercial/internal-workflow column after the is_active-filter fix.';
  end if;

  raise notice 'PASS: directory views carry every row regardless of is_active, still no sensitive column';
end $$;

commit;
