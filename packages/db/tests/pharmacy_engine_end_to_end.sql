-- ===========================================================================
-- End-to-end proof that the Pharmacy Engine chain actually connects, per
-- spec §12.18: "prescription -> pharmacy -> dispensing -> patient receipt ->
-- adherence". Exercises the full infrastructure built 2026-08-28
-- (docs/PHARMACY_ENGINE_SPEC.md) with a throwaway ACTIVATED test partner —
-- proving the machinery works without ever touching a real
-- pharmacy_partners row (all of which stay is_active=false in production;
-- see docs/PHARMACY_ENGINE_SPEC.md §1 on why that must not change here).
--
-- Run: npx supabase db query --linked -f packages/db/tests/pharmacy_engine_end_to_end.sql
-- Wrapped in BEGIN/ROLLBACK -- proves the chain, leaves the database exactly
-- as it found it.
--
-- Covers, in order:
--   A. Onboarding pipeline: application -> ... -> activated, evidence
--      columns stamped at each step, is_active flips only on the last one.
--   B. Prescription -> order -> payment_confirmed -> notification enqueued.
--   C. Pharmacist accepts (confirms qty/price/fulfilment time) ->
--      notification enqueued.
--   D. Pharmacist records the dispense (existing pharmacist_record_dispense,
--      untouched by this build) -> pharmacy_order_dispenses row exists.
--   E. Patient confirms receipt (medication_receipt_confirmations) ->
--      patient_timeline gets a medication_received event -- the
--      "adherence"/"clinical review" end of the chain, already shipped
--      2026-08-27, proven here to still connect to everything upstream.
--   F. A second order, declined (out-of-stock workflow) -> refund_status
--      flips to 'due' with the full paid amount, decline notification
--      enqueued -- §12.5/§12.9.
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- `is_active = true` line in admin_advance_pharmacy_partner_onboarding's
-- 'approved' branch and re-run -- check A9 must FAIL.
-- ===========================================================================

begin;

create temporary table e2e_fixture(k text primary key, v uuid) on commit drop;
create temporary table e2e_result(
  step text, observed text, expected text, verdict text
) on commit drop;
-- Several steps below record a result while `set local role authenticated`
-- is still active (a real client session, simulated) -- the temp tables are
-- owned by the connecting role, so authenticated needs an explicit grant to
-- write to them. Harmless: both tables are ON COMMIT DROP inside a ROLLBACK.
grant select, insert on e2e_fixture, e2e_result to authenticated;

-- --------------------------------------------------------------------------
-- Fixtures: an org's real patient, an existing admin (to run the
-- admin-gated onboarding RPCs as), a throwaway pharmacy partner + drug +
-- pharmacist login, all cleaned up by the rollback.
-- --------------------------------------------------------------------------
do $$
declare
  v_org        uuid;
  v_patient    uuid;
  v_admin      uuid;
  v_pharmacist uuid;
  v_partner    uuid;
  v_med_id     uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles -- cannot run this test';
  end if;

  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    raise exception 'no admin profile exists -- cannot run this test';
  end if;

  v_pharmacist := gen_random_uuid();
  insert into auth.users (id, email) values (v_pharmacist, 'e2etest.pharmacist@example.com');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_pharmacist, v_org, 'pharmacist', 'E2E Test Pharmacist')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.pharmacy_partners (name, delivery, regions, is_active, contact_phone)
  values ('E2E Test Pharmacy', true, array['Lagos'], false, '+2348000000000')
  returning id into v_partner;

  insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, strength, pack_size, price_kobo)
  values (v_partner, 'E2E Test Amlodipine 5mg', '5mg', '30 tablets', 150000)
  returning id into v_med_id;

  insert into e2e_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('admin', v_admin),
    ('pharmacist', v_pharmacist), ('partner', v_partner), ('medication', v_med_id);
end $$;

-- ==========================================================================
-- A. Onboarding pipeline, start to finish. All admin_* RPCs run as v_admin.
-- ==========================================================================
do $$
declare
  v_admin   uuid := (select v from e2e_fixture where k = 'admin');
  v_partner uuid := (select v from e2e_fixture where k = 'partner');
  v_location_id uuid;
  v_status  public.pharmacy_partner_onboarding_status;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- application -> business_verification
  v_status := public.admin_advance_pharmacy_partner_onboarding(v_partner);
  insert into e2e_result values ('A1: application -> business_verification', v_status::text, 'business_verification',
    case when v_status = 'business_verification' then 'PASS' else 'FAIL' end);

  -- business_verification -> regulatory_verification (stamps business_verified_at)
  v_status := public.admin_advance_pharmacy_partner_onboarding(v_partner);
  insert into e2e_result values ('A2: business_verified_at stamped',
    (select (business_verified_at is not null)::text from public.pharmacy_partners where id = v_partner),
    'true',
    case when (select business_verified_at is not null from public.pharmacy_partners where id = v_partner) then 'PASS' else 'FAIL' end);

  -- regulatory_verification -> location_verification requires license_verified_at
  begin
    perform public.admin_advance_pharmacy_partner_onboarding(v_partner);
    insert into e2e_result values ('A3: blocked without license_verified_at', 'advanced', 'blocked', 'FAIL');
  exception when others then
    insert into e2e_result values ('A3: blocked without license_verified_at', 'blocked', 'blocked', 'PASS');
  end;

  update public.pharmacy_partners set license_verified_at = now(), license_verified_by = v_admin
  where id = v_partner;
  v_status := public.admin_advance_pharmacy_partner_onboarding(v_partner);
  insert into e2e_result values ('A4: regulatory_verification -> location_verification', v_status::text, 'location_verification',
    case when v_status = 'location_verification' then 'PASS' else 'FAIL' end);

  -- location_verification -> service_configuration requires a verified location
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state)
  values (v_partner, 'E2E Branch', 'Lagos')
  returning id into v_location_id;

  begin
    perform public.admin_advance_pharmacy_partner_onboarding(v_partner);
    insert into e2e_result values ('A5: blocked without a verified location', 'advanced', 'blocked', 'FAIL');
  exception when others then
    insert into e2e_result values ('A5: blocked without a verified location', 'blocked', 'blocked', 'PASS');
  end;

  perform public.admin_verify_pharmacy_partner_location(v_location_id);
  v_status := public.admin_advance_pharmacy_partner_onboarding(v_partner);
  insert into e2e_result values ('A6: location_verification -> service_configuration', v_status::text, 'service_configuration',
    case when v_status = 'service_configuration' then 'PASS' else 'FAIL' end);

  -- service_configuration -> integration_testing (contact_phone/regions already set at creation)
  v_status := public.admin_advance_pharmacy_partner_onboarding(v_partner);
  insert into e2e_result values ('A7: service_configuration -> integration_testing', v_status::text, 'integration_testing',
    case when v_status = 'integration_testing' then 'PASS' else 'FAIL' end);

  -- integration_testing -> approved
  v_status := public.admin_advance_pharmacy_partner_onboarding(v_partner);
  insert into e2e_result values ('A8: integration_testing -> approved', v_status::text, 'approved',
    case when v_status = 'approved' then 'PASS' else 'FAIL' end);

  -- approved -> activated, is_active flips
  v_status := public.admin_advance_pharmacy_partner_onboarding(v_partner);
  insert into e2e_result values ('A9: approved -> activated, is_active flips',
    format('%s / is_active=%s', v_status, (select is_active from public.pharmacy_partners where id = v_partner)),
    'activated / is_active=true',
    case when v_status = 'activated' and (select is_active from public.pharmacy_partners where id = v_partner)
      then 'PASS' else 'FAIL' end);

  perform public.admin_link_pharmacist((select v from e2e_fixture where k = 'pharmacist'), v_partner);
  reset role;
end $$;

-- ==========================================================================
-- B. Prescription -> order -> payment_confirmed -> notification enqueued.
-- ==========================================================================
do $$
declare
  v_org       uuid := (select v from e2e_fixture where k = 'org');
  v_patient   uuid := (select v from e2e_fixture where k = 'patient');
  v_partner   uuid := (select v from e2e_fixture where k = 'partner');
  v_order_id  uuid;
  v_notif_count int;
begin
  -- A clinician-prescribed medication row, required by enforce_pharmacy_order_origin.
  insert into public.medications (organisation_id, patient_id, drug_name, source, is_active)
  values (v_org, v_patient, 'E2E Test Amlodipine 5mg', 'clinician', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.pharmacy_orders
    (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, status, fulfilment_method)
  values (
    v_org, v_patient, v_partner,
    jsonb_build_array(jsonb_build_object('drug_name', 'E2E Test Amlodipine 5mg', 'price_kobo', 150000, 'quantity', 1)),
    150000, 'pending_payment', 'pickup'
  )
  returning id into v_order_id;
  reset role;

  insert into e2e_fixture(k, v) values ('order', v_order_id);
  insert into e2e_result values ('B1: patient creates order (RLS + enforce_pharmacy_order_origin)',
    case when v_order_id is not null then 'created' else 'blocked' end, 'created',
    case when v_order_id is not null then 'PASS' else 'FAIL' end);

  -- Simulate the Paystack webhook's own write (service-role, bypasses RLS).
  update public.pharmacy_orders
  set status = 'payment_confirmed', payment_provider = 'paystack', payment_provider_ref = 'e2e-test-ref'
  where id = v_order_id;

  select count(*) into v_notif_count from public.notifications
  where template = 'pharmacy_order_patient_confirmation' and recipient_id = v_patient;
  insert into e2e_result values ('B2: payment_confirmed enqueues patient notification', v_notif_count::text, '>= 1',
    case when v_notif_count >= 1 then 'PASS' else 'FAIL' end);
end $$;

-- ==========================================================================
-- C. Pharmacist accepts -> notification enqueued.
-- ==========================================================================
do $$
declare
  v_pharmacist uuid := (select v from e2e_fixture where k = 'pharmacist');
  v_order_id   uuid := (select v from e2e_fixture where k = 'order');
  v_patient    uuid := (select v from e2e_fixture where k = 'patient');
  v_notif_count int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pharmacist::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.pharmacist_accept_order(v_order_id, '30 tablets', 150000, now() + interval '2 hours');
  reset role;

  insert into e2e_result values ('C1: order status after accept',
    (select status::text from public.pharmacy_orders where id = v_order_id), 'confirmed',
    case when (select status from public.pharmacy_orders where id = v_order_id) = 'confirmed' then 'PASS' else 'FAIL' end);

  select count(*) into v_notif_count from public.notifications
  where template = 'pharmacy_order_accepted' and recipient_id = v_patient;
  insert into e2e_result values ('C2: accept enqueues patient notification', v_notif_count::text, '>= 1',
    case when v_notif_count >= 1 then 'PASS' else 'FAIL' end);
end $$;

-- ==========================================================================
-- D. Pharmacist records the dispense (existing, untouched RPC).
-- ==========================================================================
do $$
declare
  v_pharmacist uuid := (select v from e2e_fixture where k = 'pharmacist');
  v_order_id   uuid := (select v from e2e_fixture where k = 'order');
  v_dispense_count int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pharmacist::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.pharmacist_record_dispense(v_order_id, 'E2E Test Amlodipine 5mg', '30 tablets', current_date);
  reset role;

  select count(*) into v_dispense_count from public.pharmacy_order_dispenses where pharmacy_order_id = v_order_id;
  insert into e2e_result values ('D1: dispense recorded', v_dispense_count::text, '>= 1',
    case when v_dispense_count >= 1 then 'PASS' else 'FAIL' end);
end $$;

-- ==========================================================================
-- E. Patient confirms receipt -> patient_timeline connects (2026-08-27
-- infrastructure, proven here to still work with everything upstream).
-- ==========================================================================
do $$
declare
  v_patient  uuid := (select v from e2e_fixture where k = 'patient');
  v_org      uuid := (select v from e2e_fixture where k = 'org');
  v_order_id uuid := (select v from e2e_fixture where k = 'order');
  v_dispense_id uuid;
  v_timeline_count int;
begin
  select id into v_dispense_id from public.pharmacy_order_dispenses where pharmacy_order_id = v_order_id limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_receipt_confirmations
    (organisation_id, patient_id, pharmacy_order_dispense_id, confirmation_source)
  values (v_org, v_patient, v_dispense_id, 'patient_self_report');
  reset role;

  select count(*) into v_timeline_count from public.patient_timeline
  where patient_id = v_patient and event_type = 'medication_received'
    and source_table = 'medication_receipt_confirmations';
  insert into e2e_result values ('E1: receipt confirmation reaches patient_timeline', v_timeline_count::text, '>= 1',
    case when v_timeline_count >= 1 then 'PASS' else 'FAIL' end);
end $$;

-- ==========================================================================
-- F. A second order, declined -- out-of-stock workflow + refund flag.
-- ==========================================================================
do $$
declare
  v_org       uuid := (select v from e2e_fixture where k = 'org');
  v_patient   uuid := (select v from e2e_fixture where k = 'patient');
  v_partner   uuid := (select v from e2e_fixture where k = 'partner');
  v_pharmacist uuid := (select v from e2e_fixture where k = 'pharmacist');
  v_order_id  uuid;
  v_notif_count int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.pharmacy_orders
    (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, status, fulfilment_method)
  values (
    v_org, v_patient, v_partner,
    jsonb_build_array(jsonb_build_object('drug_name', 'E2E Test Amlodipine 5mg', 'price_kobo', 150000, 'quantity', 1)),
    150000, 'pending_payment', 'pickup'
  )
  returning id into v_order_id;
  reset role;

  update public.pharmacy_orders
  set status = 'payment_confirmed', payment_provider = 'paystack', payment_provider_ref = 'e2e-test-ref-2'
  where id = v_order_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pharmacist::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.pharmacist_decline_order(v_order_id, 'Out of stock, no restock date');
  reset role;

  insert into e2e_result values ('F1: decline sets status=cancelled + refund_status=due',
    format('%s / %s',
      (select status from public.pharmacy_orders where id = v_order_id),
      (select refund_status from public.pharmacy_orders where id = v_order_id)),
    'cancelled / due',
    case when (select status::text || '/' || coalesce(refund_status, '') from public.pharmacy_orders where id = v_order_id) = 'cancelled/due'
      then 'PASS' else 'FAIL' end);

  insert into e2e_result values ('F2: refund_amount_kobo = full paid amount',
    (select refund_amount_kobo::text from public.pharmacy_orders where id = v_order_id), '150000',
    case when (select refund_amount_kobo from public.pharmacy_orders where id = v_order_id) = 150000 then 'PASS' else 'FAIL' end);

  select count(*) into v_notif_count from public.notifications
  where template = 'pharmacy_order_declined' and recipient_id = v_patient;
  insert into e2e_result values ('F3: decline enqueues patient notification', v_notif_count::text, '>= 1',
    case when v_notif_count >= 1 then 'PASS' else 'FAIL' end);
end $$;

select step, observed, expected, verdict
from e2e_result
order by verdict desc, step;

rollback;
