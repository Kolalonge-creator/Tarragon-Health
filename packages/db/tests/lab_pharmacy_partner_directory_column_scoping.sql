-- lab_providers / pharmacy_partners column-scoping — RLS verification.
--
-- Both tables carried a `for select to authenticated using (true)` policy
-- from the original 20260705211315_care_coordination.sql migration — the
-- exact same shape specialist_providers had until it was fixed 2026-09-10
-- (20260910172703_specialist_providers_commercial_columns_off_the_patient_
-- surface.sql). lab_providers and pharmacy_partners were not fixed at the
-- same time and were found still open during the same-day review of the
-- clinical_staff column-exposure fix. Confirmed live 2026-09-25 with a
-- simulated patient session before the fix (see
-- 20260925023144_restrict_lab_pharmacy_partner_read_to_safe_columns.sql): a
-- patient could read all 4 lab_providers rows including 4 populated
-- cost_basis_note values (negotiated-rate evidence).
--
-- Seven things to prove:
--   1. A patient cannot read either base table directly, including a row
--      that is_active = true.
--   2. Neither can an ordinary org-staff/clinician session — unlike
--      clinical_staff_directory, this fix does not admit is_org_staff();
--      only admin or the specific partners.*.manage permission does.
--   3. The same patient still sees the safe, patient-facing columns via
--      public.lab_provider_directory / public.pharmacy_partner_directory.
--   4. Neither directory view carries a commercial or internal-workflow
--      column, checked structurally so a future widening fails loudly.
--   5. An admin session keeps full base-table access, sensitive columns
--      included — the fix narrows the general-authenticated path only.
--   6. Sabotage: reinstating the old `using (true)` policy inside this same
--      rolled-back transaction reproduces the leak on both tables, proving
--      this test would have caught the original bug rather than passing
--      vacuously.
--   7. Both directory views keep carrying a row after is_active flips to
--      false — proven for each, and each individually sabotaged by
--      reinstating a `where is_active` clause (the views' own first, buggy
--      version, found and fixed same-day by /code-review high before merge
--      — see 20260925024716_fix_lab_pharmacy_directory_active_filter_and_
--      replay_guard.sql) to confirm the row really does disappear without
--      this fix. Both sides are sabotaged independently, not just one, so a
--      regression on either view alone would still be caught.
--
-- Run: npx supabase db query --linked -f packages/db/tests/lab_pharmacy_partner_directory_column_scoping.sql
-- (or paste into execute_sql / the SQL editor — already wrapped in
-- begin/rollback below, nothing here is ever committed.)

begin;

do $$
declare
  v_org           uuid;
  v_patient       uuid := gen_random_uuid();
  v_clinician     uuid := gen_random_uuid();
  v_admin         uuid := gen_random_uuid();
  v_lab_id        uuid;
  v_pharmacy_id   uuid;
  v_count         integer;
  v_sensitive     integer;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'SETUP: need at least one organisation to run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient,   'lab-pharmacy-scoping-test-patient@example.invalid',   'x', now(), '{}', '{}'),
    (v_clinician, 'lab-pharmacy-scoping-test-clinician@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin,     'lab-pharmacy-scoping-test-admin@example.invalid',     'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'patient',   full_name = 'Lab Pharmacy Scoping Test Patient'   where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Lab Pharmacy Scoping Test Clinician' where id = v_clinician;
  update public.profiles set organisation_id = v_org, role = 'admin',     full_name = 'Lab Pharmacy Scoping Test Admin'     where id = v_admin;

  insert into public.lab_providers
    (name, home_collection, regions, is_active, integration_status, accreditation,
     cost_basis, cost_basis_verified_at, cost_basis_verified_by, cost_basis_note,
     compliance_owner_profile_id, status_notes, license_type, license_number)
  values
    ('Scoping Test Lab', true, array['Lagos'], true, 'manual', 'ISO 15189',
     'contracted_invoice', now(), v_admin, 'SCOPE_TEST_NEGOTIATED_RATE_EVIDENCE',
     v_admin, 'SCOPE_TEST_INTERNAL_NOTE', 'NAFDAC', 'SCOPE-LAB-0001')
  returning id into v_lab_id;

  insert into public.pharmacy_partners
    (name, delivery, regions, is_active, business_registration_number, compliance_owner_profile_id,
     onboarding_status, rejection_reason, license_type, license_number)
  values
    ('Scoping Test Pharmacy', true, array['Lagos'], true, 'SCOPE_TEST_RC_1234567', v_admin,
     'activated', null, 'PCN', 'SCOPE-PHARM-0001')
  returning id into v_pharmacy_id;

  -- ======================================================================
  -- 1) NEGATIVE: a patient cannot read either base table directly, even an
  --    is_active row.
  -- ======================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.lab_providers where id = v_lab_id;
  if v_count <> 0 then
    raise exception 'FAIL 1a: a patient could read lab_providers directly (base table) — the column-exposure gap is back';
  end if;

  select count(*) into v_count from public.pharmacy_partners where id = v_pharmacy_id;
  if v_count <> 0 then
    raise exception 'FAIL 1b: a patient could read pharmacy_partners directly (base table) — the column-exposure gap is back';
  end if;
  raise notice 'PASS 1: a patient cannot read either base table directly';

  reset role;

  -- ======================================================================
  -- 2) NEGATIVE: an ordinary org-staff/clinician session (is_org_staff,
  --    but not admin and not partners.*.manage) is ALSO refused the base
  --    tables — unlike clinical_staff_directory's org-staff carve-out, this
  --    fix only admits admin or the specific manage permission.
  -- ======================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinician, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.lab_providers where id = v_lab_id;
  if v_count <> 0 then
    raise exception 'FAIL 2a: an ordinary clinician (org staff, not admin/partner-manager) could read lab_providers directly';
  end if;

  select count(*) into v_count from public.pharmacy_partners where id = v_pharmacy_id;
  if v_count <> 0 then
    raise exception 'FAIL 2b: an ordinary clinician (org staff, not admin/partner-manager) could read pharmacy_partners directly';
  end if;
  raise notice 'PASS 2: an ordinary clinician session cannot read either base table directly';

  reset role;

  -- ======================================================================
  -- 3) POSITIVE: the same patient can still see the safe, patient-facing
  --    columns via the directory views.
  -- ======================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.lab_provider_directory
  where id = v_lab_id and name = 'Scoping Test Lab' and license_number = 'SCOPE-LAB-0001';
  if v_count <> 1 then
    raise exception 'FAIL 3a: a patient could not see the lab''s safe columns via lab_provider_directory — booking display is broken';
  end if;

  select count(*) into v_count
  from public.pharmacy_partner_directory
  where id = v_pharmacy_id and name = 'Scoping Test Pharmacy' and license_number = 'SCOPE-PHARM-0001';
  if v_count <> 1 then
    raise exception 'FAIL 3b: a patient could not see the pharmacy''s safe columns via pharmacy_partner_directory — catalogue display is broken';
  end if;
  raise notice 'PASS 3: a patient can still see safe columns via both directory views';

  reset role;

  -- ======================================================================
  -- 4) NEGATIVE (structural): neither directory view carries a commercial
  --    or internal-workflow column, regardless of session — catches a
  --    future CREATE OR REPLACE VIEW that widens one back open.
  -- ======================================================================
  select count(*) into v_sensitive
  from information_schema.columns
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
    );
  if v_sensitive <> 0 then
    raise exception 'FAIL 4: a directory view exposes % commercial/internal-workflow column(s)', v_sensitive;
  end if;
  raise notice 'PASS 4: neither directory view carries a commercial/internal-workflow column';

  -- ======================================================================
  -- 5) POSITIVE CONTROL: admin access to the full base tables (including
  --    sensitive columns) is unaffected — this fix narrows the general-
  --    authenticated path only, not private.is_admin().
  -- ======================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.lab_providers
  where id = v_lab_id and cost_basis_note = 'SCOPE_TEST_NEGOTIATED_RATE_EVIDENCE';
  if v_count <> 1 then
    raise exception 'FAIL 5a: admin lost base-table access to lab_providers'' sensitive columns — the fix over-narrowed';
  end if;

  select count(*) into v_count
  from public.pharmacy_partners
  where id = v_pharmacy_id and business_registration_number = 'SCOPE_TEST_RC_1234567';
  if v_count <> 1 then
    raise exception 'FAIL 5b: admin lost base-table access to pharmacy_partners'' sensitive columns — the fix over-narrowed';
  end if;
  raise notice 'PASS 5: admin still has full base-table access, sensitive columns included';

  reset role;

  -- ======================================================================
  -- 6) SABOTAGE: reinstate the old, pre-fix `using (true)` policy on both
  --    tables and prove the same patient session would then leak the
  --    sensitive columns — confirms this test actually discriminates
  --    rather than passing vacuously. Restored before this transaction
  --    rolls back, but restored explicitly anyway so a failure partway
  --    through this section still leaves nothing committed.
  -- ======================================================================
  drop policy lab_providers_select on public.lab_providers;
  create policy lab_providers_select on public.lab_providers for select to authenticated using (true);

  drop policy pharmacy_partners_select on public.pharmacy_partners;
  create policy pharmacy_partners_select on public.pharmacy_partners for select to authenticated using (true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.lab_providers
  where id = v_lab_id and cost_basis_note = 'SCOPE_TEST_NEGOTIATED_RATE_EVIDENCE';
  if v_count <> 1 then
    raise exception 'SABOTAGE FAILED (lab_providers): reinstating `using (true)` did not reproduce the leak — this test would not have caught the original bug';
  end if;

  select count(*) into v_count
  from public.pharmacy_partners
  where id = v_pharmacy_id and business_registration_number = 'SCOPE_TEST_RC_1234567';
  if v_count <> 1 then
    raise exception 'SABOTAGE FAILED (pharmacy_partners): reinstating `using (true)` did not reproduce the leak — this test would not have caught the original bug';
  end if;
  raise notice 'SABOTAGE CONFIRMED: `using (true)` does leak cost_basis_note and business_registration_number to a patient on both tables';

  reset role;

  drop policy lab_providers_select on public.lab_providers;
  create policy lab_providers_select on public.lab_providers
    for select to authenticated
    using (private.is_admin() or private.has_permission('partners.labs.manage'::text));

  drop policy pharmacy_partners_select on public.pharmacy_partners;
  create policy pharmacy_partners_select on public.pharmacy_partners
    for select to authenticated
    using (private.is_admin() or private.has_permission('partners.pharmacies.manage'::text));

  -- ======================================================================
  -- 7) POSITIVE: a directory view keeps resolving a provider/partner after
  --    it goes inactive (attribution must survive is_active flipping).
  --    SABOTAGE: reinstating a `where is_active` clause on the view (its
  --    own first, buggy shape) reproduces the "attribution silently
  --    disappears" regression, then it's restored.
  -- ======================================================================
  update public.lab_providers set is_active = false where id = v_lab_id;
  update public.pharmacy_partners set is_active = false where id = v_pharmacy_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.lab_provider_directory where id = v_lab_id;
  if v_count <> 1 then
    raise exception 'FAIL 7a: lab_provider_directory dropped a row the moment is_active went false — attribution reads (a patient''s past lab order, a finance officer''s historical statement) would silently lose the provider name';
  end if;

  select count(*) into v_count from public.pharmacy_partner_directory where id = v_pharmacy_id;
  if v_count <> 1 then
    raise exception 'FAIL 7b: pharmacy_partner_directory dropped a row the moment is_active went false — same attribution regression on the pharmacy side';
  end if;
  raise notice 'PASS 7: both directory views keep resolving a provider/partner that has since gone inactive';

  reset role;

  create or replace view public.lab_provider_directory
    with (security_invoker = false)
    as
    select id, name, home_collection, regions, is_active, integration_status, accreditation,
           license_type, license_number, license_expires_at, license_verified_at
    from public.lab_providers
    where is_active;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.lab_provider_directory where id = v_lab_id;
  if v_count <> 0 then
    raise exception 'SABOTAGE FAILED (7a): reinstating `where is_active` on lab_provider_directory did not reproduce the attribution regression — this test would not have caught it';
  end if;
  raise notice 'SABOTAGE CONFIRMED (7a): the buggy `where is_active` shape does drop an inactive provider''s row';

  reset role;

  create or replace view public.lab_provider_directory
    with (security_invoker = false)
    as
    select id, name, home_collection, regions, is_active, integration_status, accreditation,
           license_type, license_number, license_expires_at, license_verified_at
    from public.lab_providers;

  -- Same sabotage, pharmacy side -- 7a's proof only covered lab_provider_
  -- directory; without this, a future `where is_active` reintroduced on
  -- pharmacy_partner_directory alone would pass PASS 7 vacuously (7b's
  -- positive check ran before any sabotage, so it can't tell "correctly
  -- unfiltered" from "never actually tested").
  create or replace view public.pharmacy_partner_directory
    with (security_invoker = false)
    as
    select id, name, delivery, regions, is_active, address, latitude, longitude, state, city, area,
           delivery_fee_kobo, license_type, license_number, license_expires_at, license_verified_at
    from public.pharmacy_partners
    where is_active;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.pharmacy_partner_directory where id = v_pharmacy_id;
  if v_count <> 0 then
    raise exception 'SABOTAGE FAILED (7b): reinstating `where is_active` on pharmacy_partner_directory did not reproduce the attribution regression — this test would not have caught it';
  end if;
  raise notice 'SABOTAGE CONFIRMED (7b): the buggy `where is_active` shape does drop an inactive partner''s row';

  reset role;

  create or replace view public.pharmacy_partner_directory
    with (security_invoker = false)
    as
    select id, name, delivery, regions, is_active, address, latitude, longitude, state, city, area,
           delivery_fee_kobo, license_type, license_number, license_expires_at, license_verified_at
    from public.pharmacy_partners;

  raise notice 'ALL LAB_PROVIDERS / PHARMACY_PARTNERS COLUMN-SCOPING CHECKS PASSED';
end $$;

rollback;
