-- ===========================================================================
-- Verification: 20260923003251_resolve_patient_service_access
--
-- The gap this closes: a founder-commissioned launch-scope audit asks for one
-- server-side read model answering "what clinician-backed service does this
-- patient have right now" -- before this, nothing aggregated service_purchases
-- into a single status, so any ServiceStatusCard-style UI would have had to
-- guess at, or duplicate, the entitlement logic that already lives in
-- private.patient_has_feature_access.
--
-- This script proves:
--   * a patient with no active service_purchases resolves to 'self_tracking';
--   * a patient with an active continuous_monitoring_90d purchase resolves to
--     'monitoring_active' with monitoringExpiresAt matching the purchase's
--     expires_at;
--   * a patient with an active purchase of a DIFFERENT (non-monitoring)
--     product resolves to 'service_active' -- and that monitoring still wins
--     when both are true simultaneously (a patient with both an active
--     monitoring purchase and an active non-monitoring one resolves to
--     'monitoring_active', not 'service_active'), proving the priority order
--     actually discriminates rather than being untested;
--   * an authorised caregiver (a live, non-expired profile_access grant) and
--     org staff of the patient's own organisation can both read the status;
--   * a caller with none of those three relationships is refused (42501);
--   * a sabotage run -- calling as an org-staff member of a DIFFERENT
--     organisation -- confirms the org-staff branch actually discriminates by
--     org rather than admitting any staff account.
--
-- Deliberately does not exercise a "review in progress" state -- that would
-- read annual_health_checks.review_requested_at, a column owned by a still-
-- unmerged sibling branch (see the migration's own header for why this
-- version does not depend on it).
--
-- Fixtures are self-built (a fresh org, patients, caregiver, and org-staff
-- account), never selected from live data, run against a freshly reset local
-- stack -- same convention as weight_management_enrolment_on_purchase.sql.
-- Every simulated-session check runs via set_config('request.jwt.claim.sub', ...)
-- + role 'authenticated', the same shape private RLS/RPC proofs on this
-- project already use, run as the `authenticated` role rather than `postgres`
-- so the SELECT/EXECUTE grants are genuinely exercised.
--
-- Wrapped in BEGIN/ROLLBACK -- a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table rpsa_fixture(k text primary key, v uuid) on commit drop;
create temporary table rpsa_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- The checks below switch the session role to 'authenticated' to genuinely
-- exercise the function's EXECUTE grant (not just call it as postgres, which
-- would bypass the grant entirely) -- so the scratch tables themselves need
-- an explicit grant, the same reason every real table in this codebase needs
-- its own `grant ... to authenticated` (see CLAUDE.md's standing lesson on
-- this exact gotcha).
grant select, insert on rpsa_fixture, rpsa_result to authenticated;

-- --------------------------------------------------------------------------
-- Fixtures: two orgs, a monitoring patient, a both-monitoring-and-other-
-- purchase patient, an other-purchase-only patient, a self-tracking patient,
-- a caregiver with a live profile_access grant on the monitoring patient, and
-- an org-staff account per org.
-- --------------------------------------------------------------------------
do $$
declare
  v_org_a         uuid := gen_random_uuid();
  v_org_b         uuid := gen_random_uuid();
  v_monitoring_pt uuid := gen_random_uuid();
  v_both_pt       uuid := gen_random_uuid();
  v_other_pt      uuid := gen_random_uuid();
  v_tracking_pt   uuid := gen_random_uuid();
  v_caregiver     uuid := gen_random_uuid();
  v_org_a_staff   uuid := gen_random_uuid();
  v_org_b_staff   uuid := gen_random_uuid();
  v_stranger      uuid := gen_random_uuid();
  v_monitoring_product uuid;
  v_other_product      uuid;
  v_purchase      uuid;
begin
  insert into public.organisations (id, name, type)
  values
    (v_org_a, 'RPSA Test Org A', 'direct_consumer'),
    (v_org_b, 'RPSA Test Org B', 'direct_consumer')
  on conflict (id) do nothing;

  select id into v_monitoring_product
    from public.service_products
   where code like 'continuous_monitoring_%'
   order by is_active desc, price_kobo
   limit 1;
  if v_monitoring_product is null then
    raise exception 'no continuous_monitoring_%% product available -- cannot run this test';
  end if;

  -- Resolved by shape, not a hardcoded code (per the lesson in
  -- weight_management_enrolment_on_purchase.sql): whatever product this
  -- points at, it must stay a real, active, non-monitoring product.
  select id into v_other_product
    from public.service_products
   where is_active and currency = 'NGN' and price_kobo > 0
     and code not like 'continuous_monitoring_%'
   order by price_kobo, code
   limit 1;
  if v_other_product is null then
    raise exception 'no active non-monitoring NGN product available -- cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_monitoring_pt, 'rpsa-monitoring@example.invalid', 'x', now(), '{}', '{}'),
    (v_both_pt, 'rpsa-both@example.invalid', 'x', now(), '{}', '{}'),
    (v_other_pt, 'rpsa-other@example.invalid', 'x', now(), '{}', '{}'),
    (v_tracking_pt, 'rpsa-tracking@example.invalid', 'x', now(), '{}', '{}'),
    (v_caregiver, 'rpsa-caregiver@example.invalid', 'x', now(), '{}', '{}'),
    (v_org_a_staff, 'rpsa-org-a-staff@example.invalid', 'x', now(), '{}', '{}'),
    (v_org_b_staff, 'rpsa-org-b-staff@example.invalid', 'x', now(), '{}', '{}'),
    (v_stranger, 'rpsa-stranger@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_monitoring_pt, v_org_a, 'patient', 'RPSA Monitoring Patient'),
    (v_both_pt, v_org_a, 'patient', 'RPSA Both Patient'),
    (v_other_pt, v_org_a, 'patient', 'RPSA Other Patient'),
    (v_tracking_pt, v_org_a, 'patient', 'RPSA Tracking Patient'),
    (v_caregiver, v_org_a, 'patient', 'RPSA Caregiver'),
    (v_org_a_staff, v_org_a, 'clinician', 'RPSA Org A Staff'),
    (v_org_b_staff, v_org_b, 'clinician', 'RPSA Org B Staff'),
    (v_stranger, v_org_a, 'patient', 'RPSA Stranger')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, active, license_verified_at, doctor_tier, employment_type)
  values
    (v_org_a_staff, v_org_a, 'RPSA Org A Staff', true, now(), 'medical_officer', 'employed'),
    (v_org_b_staff, v_org_b, 'RPSA Org B Staff', true, now(), 'medical_officer', 'employed')
  on conflict (profile_id) do update set organisation_id = excluded.organisation_id, active = true, license_verified_at = excluded.license_verified_at;

  -- Monitoring patient: only an active continuous_monitoring purchase, 90 days out.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values (v_org_a, v_monitoring_pt, v_monitoring_pt, v_monitoring_product, 'active',
          3000000, 'NGN', now(), now() + interval '90 days')
  returning id into v_purchase;

  -- Both patient: an active monitoring purchase AND an active other purchase
  -- -- proves monitoring wins the priority order rather than the ordering
  -- being untested.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org_a, v_both_pt, v_both_pt, v_monitoring_product, 'active', 3000000, 'NGN', now(), now() + interval '90 days'),
    (v_org_a, v_both_pt, v_both_pt, v_other_product, 'active', 1000000, 'NGN', now(), null);

  -- Other patient: an active purchase of a genuinely different, non-monitoring product.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at)
  values (v_org_a, v_other_pt, v_other_pt, v_other_product, 'active', 1000000, 'NGN', now());

  -- Caregiver: a live, non-expired profile_access grant on the monitoring patient.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, expires_at)
  values (v_monitoring_pt, v_caregiver, 'view', v_monitoring_pt, now() + interval '30 days');

  insert into rpsa_fixture values
    ('org_a', v_org_a), ('org_b', v_org_b),
    ('monitoring_pt', v_monitoring_pt), ('both_pt', v_both_pt), ('other_pt', v_other_pt), ('tracking_pt', v_tracking_pt),
    ('caregiver', v_caregiver), ('org_a_staff', v_org_a_staff), ('org_b_staff', v_org_b_staff),
    ('stranger', v_stranger), ('purchase', v_purchase);
end $$;

-- ==========================================================================
-- 1. Self access: monitoring_active, with the right expiry.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from rpsa_fixture where k = 'monitoring_pt');
  v_expected_expiry timestamptz := (select expires_at from public.service_purchases where id = (select v from rpsa_fixture where k = 'purchase'));
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_patient::text, true);
  perform set_config('role', 'authenticated', true);

  select public.resolve_patient_service_access(v_patient) into v_result;

  insert into rpsa_result values (
    'monitoring patient self-access status is monitoring_active',
    coalesce(v_result->>'status', 'null'), 'monitoring_active',
    case when v_result->>'status' = 'monitoring_active' then 'PASS' else 'FAIL' end
  );
  insert into rpsa_result values (
    'monitoringExpiresAt matches the purchase expires_at',
    coalesce(v_result->>'monitoringExpiresAt', 'null'), v_expected_expiry::text,
    case when (v_result->>'monitoringExpiresAt')::timestamptz = v_expected_expiry then 'PASS' else 'FAIL' end
  );

  if v_result->>'status' is distinct from 'monitoring_active' then
    raise exception 'HOLE OPEN: an active continuous_monitoring purchase did not resolve to monitoring_active, got %', v_result->>'status';
  end if;
  if (v_result->>'monitoringExpiresAt')::timestamptz is distinct from v_expected_expiry then
    raise exception 'HOLE OPEN: monitoringExpiresAt did not match the real purchase expiry';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 2. Self access: monitoring wins over an unrelated active purchase when
--    both are true for the same patient.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from rpsa_fixture where k = 'both_pt');
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_patient::text, true);
  perform set_config('role', 'authenticated', true);

  select public.resolve_patient_service_access(v_patient) into v_result;

  insert into rpsa_result values (
    'a patient with both monitoring and another active purchase resolves to monitoring_active',
    coalesce(v_result->>'status', 'null'), 'monitoring_active',
    case when v_result->>'status' = 'monitoring_active' then 'PASS' else 'FAIL' end
  );

  if v_result->>'status' is distinct from 'monitoring_active' then
    raise exception 'HOLE OPEN: monitoring did not take priority over an unrelated active purchase, got %', v_result->>'status';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 3. Self access: an active purchase of a non-monitoring product resolves to
--    service_active.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from rpsa_fixture where k = 'other_pt');
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_patient::text, true);
  perform set_config('role', 'authenticated', true);

  select public.resolve_patient_service_access(v_patient) into v_result;

  insert into rpsa_result values (
    'a patient with only a non-monitoring active purchase resolves to service_active',
    coalesce(v_result->>'status', 'null'), 'service_active',
    case when v_result->>'status' = 'service_active' then 'PASS' else 'FAIL' end
  );

  if v_result->>'status' is distinct from 'service_active' then
    raise exception 'HOLE OPEN: an active non-monitoring purchase did not resolve to service_active, got %', v_result->>'status';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 4. Self access: a patient with nothing active resolves to self_tracking.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from rpsa_fixture where k = 'tracking_pt');
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_patient::text, true);
  perform set_config('role', 'authenticated', true);

  select public.resolve_patient_service_access(v_patient) into v_result;

  insert into rpsa_result values (
    'patient with no active service resolves to self_tracking',
    coalesce(v_result->>'status', 'null'), 'self_tracking',
    case when v_result->>'status' = 'self_tracking' then 'PASS' else 'FAIL' end
  );

  if v_result->>'status' is distinct from 'self_tracking' then
    raise exception 'HOLE OPEN: a patient with no active entitlement did not resolve to self_tracking, got %', v_result->>'status';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 5. Authorised readers: a caregiver with a live profile_access grant, and
--    org staff of the patient's own organisation, can both read the status.
-- ==========================================================================
do $$
declare
  v_patient    uuid := (select v from rpsa_fixture where k = 'monitoring_pt');
  v_caregiver  uuid := (select v from rpsa_fixture where k = 'caregiver');
  v_org_a_staff uuid := (select v from rpsa_fixture where k = 'org_a_staff');
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_caregiver::text, true);
  perform set_config('role', 'authenticated', true);
  select public.resolve_patient_service_access(v_patient) into v_result;
  insert into rpsa_result values (
    'caregiver with a live profile_access grant can read the status',
    coalesce(v_result->>'status', 'null'), 'monitoring_active',
    case when v_result->>'status' = 'monitoring_active' then 'PASS' else 'FAIL' end
  );
  if v_result is null then
    raise exception 'HOLE OPEN: an authorised caregiver was refused';
  end if;

  perform set_config('request.jwt.claim.sub', v_org_a_staff::text, true);
  select public.resolve_patient_service_access(v_patient) into v_result;
  insert into rpsa_result values (
    'org staff of the patient''s own org can read the status',
    coalesce(v_result->>'status', 'null'), 'monitoring_active',
    case when v_result->>'status' = 'monitoring_active' then 'PASS' else 'FAIL' end
  );
  if v_result is null then
    raise exception 'HOLE OPEN: org staff of the patient''s own organisation was refused';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 6. A caller with no relationship to the patient is refused (42501).
-- ==========================================================================
do $$
declare
  v_patient  uuid := (select v from rpsa_fixture where k = 'monitoring_pt');
  v_stranger uuid := (select v from rpsa_fixture where k = 'stranger');
  v_refused  boolean := false;
begin
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.resolve_patient_service_access(v_patient);
  exception when sqlstate '42501' then
    v_refused := true;
  end;

  insert into rpsa_result values (
    'a stranger with no relationship to the patient is refused',
    v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end
  );

  if not v_refused then
    raise exception 'HOLE OPEN: an unrelated caller was able to read another patient''s service status';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 7. SABOTAGE: org staff of a DIFFERENT organisation must still be refused --
--    confirms the org-staff branch discriminates by the patient's own org,
--    not just "is this caller staff of any org."
-- ==========================================================================
do $$
declare
  v_patient     uuid := (select v from rpsa_fixture where k = 'monitoring_pt');
  v_org_b_staff uuid := (select v from rpsa_fixture where k = 'org_b_staff');
  v_refused     boolean := false;
begin
  perform set_config('request.jwt.claim.sub', v_org_b_staff::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.resolve_patient_service_access(v_patient);
  exception when sqlstate '42501' then
    v_refused := true;
  end;

  insert into rpsa_result values (
    'SABOTAGE: staff of a different organisation is refused (not any-org staff)',
    v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end
  );

  if not v_refused then
    raise exception 'HOLE OPEN: staff of an unrelated organisation could read this patient''s service status -- the org-staff check is not scoping by organisation';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

select check_name, observed, expected, verdict
from rpsa_result
order by verdict desc, check_name;

rollback;
