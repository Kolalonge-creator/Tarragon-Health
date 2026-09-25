-- clinical_staff column-scoping — RLS verification.
--
-- clinical_staff_select's original org-wide clause ("organisation_id =
-- current_org_id()") was written 20260712191500 so a patient could see their
-- clinician's/Clinical Director's name/photo/bio for trust display. Every
-- sensitive column added to the table since (indemnity_insurer,
-- indemnity_policy_number, indemnity_expires_at, indemnity_exempt_by,
-- staff_number, verified_by, credential_verified_by) rode along on that same
-- row-level clause — Postgres RLS is row-level, not column-level — so any
-- patient could SELECT * any clinical_staff row in their own org directly via
-- the Supabase client SDK / PostgREST, not just the safe columns the app's own
-- queries happen to list. Confirmed live 2026-09-25 with a simulated patient
-- session before the fix (see 20260925015430_restrict_clinical_staff_patient_
-- read_to_safe_columns.sql).
--
-- Six things to prove:
--   1. A patient can no longer read any clinical_staff row directly (base
--      table), including one in their own org.
--   2. public.clinical_staff_directory (the safe-column replacement every
--      patient-facing call site was moved to) still lets that same patient
--      see the trust-display columns for the same doctor.
--   3. clinical_staff_directory never carries a sensitive column, checked
--      structurally so a future ALTER VIEW widening it fails loudly.
--   4. org staff access to the full base table (including sensitive columns)
--      is unaffected — the fix narrows the patient path only.
--   5. Sabotage: reinstating the old broad policy inside this same rolled-
--      back transaction reproduces the leak, proving this test would have
--      caught the original bug rather than passing vacuously.
--   6. A service-role caller (no auth.uid() at all — cron jobs, internal
--      notification routes) still sees the view's rows, per
--      20260925021440_fix_clinical_staff_directory_service_role_and_replay_
--      guard.sql. Sabotaged the same way: drop the service-role clause,
--      confirm the caller goes blind, restore it.
--
-- Run: npx supabase db query --linked -f packages/db/tests/clinical_staff_directory_column_scoping.sql
-- (or paste into execute_sql / the SQL editor — already wrapped in
-- begin/rollback below, nothing here is ever committed.)

begin;

do $$
declare
  v_org         uuid;
  v_patient     uuid := gen_random_uuid();
  v_staff_login uuid := gen_random_uuid();
  v_staff_id    uuid;
  v_count       integer;
  v_sensitive   integer;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'SETUP: need at least one organisation to run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'clinical-staff-scoping-test-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff_login, 'clinical-staff-scoping-test-staff@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Clinical Staff Scoping Test Patient'
    where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Clinical Staff Scoping Test Staff'
    where id = v_staff_login;

  insert into public.clinical_staff
    (organisation_id, full_name, credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at, staff_number, license_verified_at, active)
  values
    (v_org, 'Scoping Test Doctor', 'MDCN', 'SCOPE-TEST-0001', 'SCOPE_TEST_INSURER', 'SCOPE_TEST_POLICY_999', now() + interval '1 year', 'EMP-SCOPETEST', now(), true)
  returning id into v_staff_id;

  -- ======================================================================
  -- 1) NEGATIVE: a patient cannot read the base table at all, even a row in
  --    their own org.
  -- ======================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.clinical_staff where id = v_staff_id;
  if v_count <> 0 then
    raise exception 'FAIL 1: a patient could read clinical_staff directly (base table) — the column-exposure gap is back';
  end if;
  raise notice 'PASS 1: a patient cannot read clinical_staff directly';

  -- ======================================================================
  -- 2) POSITIVE: the same patient can still see the safe trust-display
  --    columns via clinical_staff_directory.
  -- ======================================================================
  select count(*) into v_count
  from public.clinical_staff_directory
  where id = v_staff_id and full_name = 'Scoping Test Doctor' and credential_number = 'SCOPE-TEST-0001';
  if v_count <> 1 then
    raise exception 'FAIL 2: a patient could not see the doctor''s safe columns via clinical_staff_directory — trust display is broken';
  end if;
  raise notice 'PASS 2: a patient can still see safe columns via clinical_staff_directory';

  reset role;

  -- ======================================================================
  -- 3) NEGATIVE (structural): clinical_staff_directory never carries a
  --    sensitive column, regardless of session — catches a future
  --    ALTER VIEW/CREATE OR REPLACE VIEW that widens it back open.
  -- ======================================================================
  select count(*) into v_sensitive
  from information_schema.columns
  where table_schema = 'public' and table_name = 'clinical_staff_directory'
    and column_name in (
      'indemnity_insurer', 'indemnity_policy_number', 'indemnity_expires_at',
      'indemnity_exempt', 'indemnity_exempt_by', 'staff_number',
      'verified_by', 'credential_verified_by', 'credential_verified_at',
      'license_verified_at', 'license_expires_at', 'red_flag_attested_at'
    );
  if v_sensitive <> 0 then
    raise exception 'FAIL 3: clinical_staff_directory exposes % sensitive column(s)', v_sensitive;
  end if;
  raise notice 'PASS 3: clinical_staff_directory carries no sensitive column';

  -- ======================================================================
  -- 4) POSITIVE CONTROL: org staff access to the full base table (including
  --    sensitive columns) is unaffected — this fix narrows the patient path
  --    only, not is_org_staff().
  -- ======================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_login, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.clinical_staff
  where id = v_staff_id and indemnity_policy_number = 'SCOPE_TEST_POLICY_999' and staff_number = 'EMP-SCOPETEST';
  if v_count <> 1 then
    raise exception 'FAIL 4: org staff lost base-table access to sensitive columns — the fix over-narrowed';
  end if;
  raise notice 'PASS 4: org staff still has full base-table access, sensitive columns included';

  reset role;

  -- ======================================================================
  -- 5) SABOTAGE: reinstate the old, pre-fix broad clause and prove the same
  --   patient session would then leak the sensitive columns — confirms this
  --   test actually discriminates rather than passing vacuously. Rolled back
  --   with everything else at the end of this script.
  -- ======================================================================
  drop policy clinical_staff_select on public.clinical_staff;
  create policy clinical_staff_select on public.clinical_staff
    for select to authenticated
    using (
      organisation_id = private.current_org_id()
      or private.is_org_staff(organisation_id)
      or ((profile_id is not null) and private.can_support_view(profile_id))
    );

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.clinical_staff
  where id = v_staff_id and indemnity_policy_number = 'SCOPE_TEST_POLICY_999';
  if v_count <> 1 then
    raise exception 'SABOTAGE FAILED: reinstating the old broad policy did not reproduce the leak — this test would not have caught the original bug';
  end if;
  raise notice 'SABOTAGE CONFIRMED: the old broad policy does leak indemnity_policy_number to a patient — this test would have caught it';

  reset role;

  -- restore the fixed policy so section 6 below tests against the real,
  -- current state rather than the sabotaged one from section 5.
  drop policy clinical_staff_select on public.clinical_staff;
  create policy clinical_staff_select on public.clinical_staff
    for select to authenticated
    using (
      private.is_org_staff(organisation_id)
      or ((profile_id is not null) and private.can_support_view(profile_id))
    );

  -- ======================================================================
  -- 6) POSITIVE: a service-role caller (no auth.uid()) still sees the view.
  --    NEGATIVE (sabotage): dropping the service-role clause reproduces the
  --    "silent zero rows" regression this was fixed for, then it's restored.
  -- ======================================================================
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);

  select count(*) into v_count from public.clinical_staff_directory where id = v_staff_id;
  if v_count <> 1 then
    raise exception 'FAIL 6: a service-role caller could not see clinical_staff_directory — cron/internal-notification attribution is broken again';
  end if;
  raise notice 'PASS 6: a service-role caller can see clinical_staff_directory';

  perform set_config('role', 'postgres', true);

  create or replace view public.clinical_staff_directory
    with (security_invoker = false)
    as
    select
      id, organisation_id, profile_id, full_name, photo_url, credential_type,
      credential_number, specialty, bio, active, doctor_tier, employment_type,
      offers_therapy_sessions
    from public.clinical_staff
    where organisation_id = private.current_org_id()
       or private.is_org_staff(organisation_id)
       or ((profile_id is not null) and private.can_support_view(profile_id));

  perform set_config('role', 'service_role', true);

  select count(*) into v_count from public.clinical_staff_directory where id = v_staff_id;
  if v_count <> 0 then
    raise exception 'SABOTAGE FAILED (section 6): removing the service-role clause did not reproduce the zero-rows regression — this test would not have caught it';
  end if;
  raise notice 'SABOTAGE CONFIRMED (section 6): without the service-role clause, a service-role caller sees zero rows — this test would have caught it';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL CLINICAL_STAFF COLUMN-SCOPING CHECKS PASSED';
end $$;

rollback;
