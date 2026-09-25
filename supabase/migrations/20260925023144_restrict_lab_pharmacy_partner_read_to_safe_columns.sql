-- A patient (or any logged-in user) could read every column of
-- public.lab_providers and public.pharmacy_partners, including commercial
-- and internal-workflow data added long after each table's original
-- `using (true)` SELECT policy was written. Found during the same-day
-- review of the clinical_staff column-exposure fix
-- (20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql):
-- the exact same `for select to authenticated using (true)` shape, from the
-- same original migration (20260705211315_care_coordination.sql), was still
-- live on these two tables plus specialist_providers -- specialist_providers
-- was already fixed on 2026-09-10
-- (20260910172703_specialist_providers_commercial_columns_off_the_patient_
-- surface.sql); these two were not.
--
-- WHAT'S EXPOSED
-- ---------------
-- lab_providers: cost_basis / cost_basis_verified_at / cost_basis_verified_by
-- / cost_basis_note (negotiated-rate evidence -- added
-- 20260910054444_lab_provider_cost_basis.sql, entirely commercial and none
-- of a patient's business), compliance_owner_profile_id, license_verified_by,
-- status_notes, organisation_id.
-- pharmacy_partners: business_registration_number, compliance_owner_
-- profile_id, and a long run of internal onboarding-workflow columns
-- (business_verified_at/by, service_configured_at/by, integration_tested_
-- at/by, approved_at/by, rejected_at/by, rejection_reason, onboarding_status,
-- uses_platform_login, organisation_id, license_verified_by).
--
-- Confirmed live with a simulated patient session before this migration: a
-- patient reads all 4 lab_providers rows including 4 populated
-- cost_basis_note values.
--
-- WHAT'S SHOWN, AND THE SAME REASONING AS THE SPECIALIST_PROVIDERS FIX
-- -----------------------------------------------------------------------
-- license_type/license_number/license_expires_at/license_verified_at stay
-- patient-visible on both tables, for the identical reason
-- 20260910172703 gave for specialist_providers' license fields: a
-- registration number is what lets someone check "verified, and in date"
-- against the regulator themselves, and hiding it protects nothing.
--
-- contact_phone/contact_email are deliberately EXCLUDED from both directory
-- views, for the identical reason 20260910172703 excluded them from
-- specialist_providers: publishing a partner's own contact details invites
-- patients around the booking/ordering flow that carries the safeguards
-- (payment, liability, delivery tracking). A patient-facing location's own
-- contact_phone (public.lab_provider_locations, already authenticated-
-- readable, read via the SECURITY DEFINER list_lab_test_locations RPC) is a
-- different, already-scoped thing and is untouched here.
--
-- HOW, AND WHY NOT COLUMN GRANTS
-- -------------------------------
-- Same as 20260910172703: `authenticated` covers patients, clinicians and
-- finance alike, so a column grant would hide commercial data from nobody
-- who shouldn't see it while also hiding safe columns from nobody who
-- should -- it can't express the split. And a column REVOKE is a no-op
-- while the table-level grant exists (reference_column_revoke_noop_under_
-- table_grant). So, same shape as specialist_directory/therapy_directory:
-- the TABLE becomes admin-and-partner-manager only; everyone else --
-- patients, clinicians AND finance -- reads a safe-column directory view.
--
-- WHY THE VIEWS ARE OWNER-RUN
-- -----------------------------
-- Same deliberate exception as specialist_directory/therapy_directory/
-- clinical_staff_directory: a view that must survive its base table being
-- locked down has to run as its owner. Unlike clinical_staff_directory,
-- these two carry no auth.uid()-dependent predicate at all -- `where
-- is_active` is a plain catalogue filter, not a session-scoped one -- so
-- there is no service-role "silent zero rows" failure mode to guard
-- against here; a service-role caller sees exactly what an owner-run view
-- with no session predicate always shows it.
--
-- CALL SITES THIS MIGRATION REQUIRES APP-CODE CHANGES FOR
-- -----------------------------------------------------------
-- Three PostgREST embedded FK-joins resolve against the base table's own
-- RLS, not the outer query's, exactly the failure mode the clinical_staff
-- fix hit:
--   * lab-orders.ts's LAB_ORDER_SELECT: provider:lab_providers!lab_orders_
--     provider_id_fkey(name, regions) -- read by both a patient's own
--     orders and the org/clinician worklist. Neither passes the new
--     admin-or-partners.labs.manage policy.
--   * pharmacy-orders.ts's usePharmacyCatalogue: pharmacy_partner:
--     pharmacy_partners!pharmacy_medications_pharmacy_partner_id_fkey(...)
--     -- read by the patient-facing pharmacy catalogue.
--   * finance/partner-settlements/page.tsx: partner_statements' own embed
--     lab_providers(name) -- read by the `finance` role, which (per this
--     page's own standing comment) already fails private.is_org_staff, so
--     it was never going to pass an admin/partners.labs.manage gate either.
-- All three are fixed in the same PR as this migration, each replaced with
-- an explicit follow-up query against the relevant directory view, merged
-- client-side -- the same fix shape 20260925021440 used for clinical_staff's
-- equivalent embeds. The plain (non-embedded) lab_providers/pharmacy_
-- partners reads in that same finance page and in lab-orders.ts's unused
-- useLabProviders() are repointed at the directory views the same way.
-- partner-catalogues.ts's admin-console reads stay on the base tables
-- unchanged -- admin already satisfies the narrowed policy.

begin;

-- ---------------------------------------------------------------------------
-- 1. lab_provider_directory
-- ---------------------------------------------------------------------------

create view public.lab_provider_directory
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
  from public.lab_providers
  where is_active;

comment on view public.lab_provider_directory is
  'The patient-, clinician- and finance-facing window onto lab_providers. Carries the licence fields (checkable against the regulator), never cost_basis/cost_basis_note/cost_basis_verified_at/cost_basis_verified_by/compliance_owner_profile_id/status_notes/organisation_id/contact_phone/contact_email. Owner-run on purpose (no security_invoker) so it survives the base table being admin-only -- see this migration''s header. Unlike clinical_staff_directory this carries no auth.uid()-dependent predicate, so it needs no separate service-role handling.';

revoke all on public.lab_provider_directory from public;
grant select on public.lab_provider_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 2. pharmacy_partner_directory
-- ---------------------------------------------------------------------------

create view public.pharmacy_partner_directory
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
  from public.pharmacy_partners
  where is_active;

comment on view public.pharmacy_partner_directory is
  'The patient-, clinician- and finance-facing window onto pharmacy_partners. Carries the licence fields and the location/delivery-fee columns the patient-facing catalogue already selected explicitly, never business_registration_number/compliance_owner_profile_id/the onboarding-workflow *_at/*_by columns/rejection_reason/onboarding_status/uses_platform_login/organisation_id/contact_phone/contact_email. Owner-run on purpose (no security_invoker), same exception as lab_provider_directory -- see this migration''s header.';

revoke all on public.pharmacy_partner_directory from public;
grant select on public.pharmacy_partner_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The base tables stop being readable by everyone
-- ---------------------------------------------------------------------------

drop policy if exists lab_providers_select on public.lab_providers;
create policy lab_providers_select on public.lab_providers
  for select to authenticated
  using (private.is_admin() or private.has_permission('partners.labs.manage'::text));

comment on policy lab_providers_select on public.lab_providers is
  'Admin and partner-manager only, since 2026-09-25. This was `using (true)`, which handed every logged-in user cost_basis/cost_basis_note (negotiated-rate evidence) and compliance_owner_profile_id. Everyone else reads public.lab_provider_directory. Do not widen this to fix an empty-provider-list report -- repoint the caller at the directory view instead.';

drop policy if exists pharmacy_partners_select on public.pharmacy_partners;
create policy pharmacy_partners_select on public.pharmacy_partners
  for select to authenticated
  using (private.is_admin() or private.has_permission('partners.pharmacies.manage'::text));

comment on policy pharmacy_partners_select on public.pharmacy_partners is
  'Admin and partner-manager only, since 2026-09-25. This was `using (true)`, which handed every logged-in user business_registration_number, compliance_owner_profile_id and the internal onboarding-workflow columns. Everyone else reads public.pharmacy_partner_directory. Do not widen this to fix an empty-partner-list report -- repoint the caller at the directory view instead.';

-- ---------------------------------------------------------------------------
-- 4. Proof, in both directions, as real sessions. The sabotage step (proving
--    this would have caught the original bug) lives in the standing
--    regression test, packages/db/tests/lab_pharmacy_partner_directory_
--    column_scoping.sql, not in this migration.
-- ---------------------------------------------------------------------------

do $$
declare
  v_patient uuid;
  v_admin   uuid;
  v_rows    int;
begin
  select id into v_patient from public.profiles where role = 'patient' limit 1;
  select id into v_admin   from public.profiles where role = 'admin'   limit 1;

  if v_patient is null then
    raise notice 'SKIP: no patient profile to simulate';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select count(*) into v_rows from public.lab_providers;
    if v_rows <> 0 then
      reset role;
      raise exception 'FAIL: a patient session can still read % lab_providers row(s) directly.', v_rows;
    end if;

    select count(*) into v_rows from public.pharmacy_partners;
    if v_rows <> 0 then
      reset role;
      raise exception 'FAIL: a patient session can still read % pharmacy_partners row(s) directly.', v_rows;
    end if;

    perform 1 from public.lab_provider_directory limit 1;
    perform 1 from public.pharmacy_partner_directory limit 1;

    reset role;
    raise notice 'PASS: patient reads the directories, not the base tables';
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
    raise exception 'FAIL: a directory view exposes a commercial/internal-workflow column.';
  end if;

  if v_admin is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_rows from public.lab_providers;
    reset role;
    if v_rows = 0 and (select count(*) from public.lab_providers) > 0 then
      raise exception 'FAIL: an admin session can no longer read lab_providers. The partner console is broken.';
    end if;
    raise notice 'PASS: admin still reads lab_providers (% rows)', v_rows;
  end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS: commercial/internal-workflow columns are off the general-authenticated surface on both tables; licence fields stay on it';
end $$;

commit;
