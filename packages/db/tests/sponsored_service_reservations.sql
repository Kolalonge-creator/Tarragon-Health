-- ===========================================================================
-- Verification: 20260923013537/013601/013621_sponsored_service_reservation*
--
-- The gap this closes: a founder-commissioned launch-scope audit's diaspora
-- ask -- pay for a named service against a bare phone number + first name
-- (no profile created up front, no health details from the sponsor), the
-- recipient claims it themselves once they've signed up under that same
-- phone number. Before this, every purchase-for-someone path on this
-- platform (care_vouchers, sponsored_subscription) hard-required a
-- profile_access grant to already exist (private.can_purchase_voucher_for),
-- which meant a genuinely new person could never be the beneficiary.
--
-- This script proves the full lifecycle:
--   * create_sponsored_service_reservation creates a pending_payment row for
--     an authenticated sponsor;
--   * a matching payment_transactions charge.success event (the same shape
--     the real Paystack webhook inserts) activates it to 'invited' with a
--     real invite_token, via private.activate_sponsored_service_reservation;
--   * claim_sponsored_service_reservation refuses a caller whose own
--     profiles.phone does not match the reservation's recipient_phone
--     (42501) -- the load-bearing anti-impersonation check;
--   * a caller whose phone DOES match succeeds, creating a real active
--     care_vouchers row and flipping the reservation to 'claimed';
--   * SABOTAGE: the same reservation cannot be claimed a second time
--     (23514) -- proves the status<>'invited' guard actually discriminates,
--     not just that the happy path works;
--   * SABOTAGE: a payment of the wrong amount does NOT activate the
--     reservation -- proves the amount-verification check in the trigger
--     actually blocks a mismatched charge rather than trusting metadata
--     alone.
--
-- Fixtures are self-built (a fresh sponsor, a correct-phone recipient, a
-- wrong-phone recipient, a reservation), never selected from live data.
-- Every simulated-session check runs via set_config('request.jwt.claim.sub',
-- ...) + role 'authenticated', so both RPCs' EXECUTE grants are genuinely
-- exercised, not bypassed as postgres. The payment_transactions insert runs
-- as postgres (the real webhook uses a service-role client), which is
-- correct -- only the two patient-facing RPCs need the authenticated-role
-- proof.
--
-- Wrapped in BEGIN/ROLLBACK -- a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table ssr_fixture(k text primary key, v uuid) on commit drop;
create temporary table ssr_result(check_name text, observed text, expected text, verdict text) on commit drop;
grant select, insert on ssr_fixture, ssr_result to authenticated;

-- --------------------------------------------------------------------------
-- Fixtures: a sponsor, a correct-phone recipient, a wrong-phone recipient,
-- and the NGN product to reserve.
-- --------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_sponsor uuid := gen_random_uuid();
  v_recipient uuid := gen_random_uuid();
  v_wrong_phone_recipient uuid := gen_random_uuid();
  v_product uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available -- cannot run this test';
  end if;

  select id into v_product from public.service_products where is_active and currency = 'NGN' order by price_kobo limit 1;
  if v_product is null then
    raise exception 'no active NGN service product available -- cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_sponsor, 'ssr-proof-sponsor@example.invalid', 'x', now(), '{}', '{}'),
    (v_recipient, 'ssr-proof-recipient@example.invalid', 'x', now(), '{}', '{}'),
    (v_wrong_phone_recipient, 'ssr-proof-wrong-phone@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values
    (v_sponsor, v_org, 'patient', 'SSR Proof Sponsor', '+2348011110000'),
    (v_recipient, v_org, 'patient', 'SSR Proof Recipient', '+2348012345678'),
    (v_wrong_phone_recipient, v_org, 'patient', 'SSR Proof Wrong Phone', '+2348099999999')
  on conflict (id) do update set organisation_id = excluded.organisation_id, phone = excluded.phone;

  insert into ssr_fixture values
    ('org', v_org), ('sponsor', v_sponsor), ('recipient', v_recipient),
    ('wrong_phone_recipient', v_wrong_phone_recipient), ('product', v_product);
end $$;

-- ==========================================================================
-- 1. create_sponsored_service_reservation creates a pending_payment row.
-- ==========================================================================
do $$
declare
  v_sponsor uuid := (select v from ssr_fixture where k = 'sponsor');
  v_product uuid := (select v from ssr_fixture where k = 'product');
  v_id uuid;
  v_row public.sponsored_service_reservations%rowtype;
begin
  perform set_config('request.jwt.claim.sub', v_sponsor::text, true);
  perform set_config('role', 'authenticated', true);

  select public.create_sponsored_service_reservation(v_product, '+2348012345678', 'Recipient') into v_id;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);

  select * into v_row from public.sponsored_service_reservations where id = v_id;

  insert into ssr_result values (
    'reservation created with status pending_payment',
    coalesce(v_row.status::text, 'null'), 'pending_payment',
    case when v_row.status = 'pending_payment' then 'PASS' else 'FAIL' end
  );
  insert into ssr_fixture values ('reservation', v_id);

  if v_row.status is distinct from 'pending_payment' then
    raise exception 'HOLE OPEN: reservation not created correctly, got %', v_row;
  end if;
end $$;

-- ==========================================================================
-- 2. A matching charge.success payment activates the reservation.
-- ==========================================================================
do $$
declare
  v_reservation uuid := (select v from ssr_fixture where k = 'reservation');
  v_org uuid := (select v from ssr_fixture where k = 'org');
  v_amount bigint;
  v_row public.sponsored_service_reservations%rowtype;
begin
  select amount_kobo into v_amount from public.sponsored_service_reservations where id = v_reservation;

  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (
    v_org, 'paystack', 'ssr-proof-ref-1', 'charge.success', v_amount, 'NGN',
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'ssr-proof-ref-1',
      'metadata', jsonb_build_object('kind', 'sponsored_service_reservation', 'reservation_id', v_reservation::text)
    ))
  );

  select * into v_row from public.sponsored_service_reservations where id = v_reservation;

  insert into ssr_result values (
    'payment activates reservation to invited',
    coalesce(v_row.status::text, 'null'), 'invited',
    case when v_row.status = 'invited' then 'PASS' else 'FAIL' end
  );
  insert into ssr_result values (
    'invite_token minted',
    case when v_row.invite_token is not null then 'set' else 'null' end, 'set',
    case when v_row.invite_token is not null then 'PASS' else 'FAIL' end
  );

  if v_row.status is distinct from 'invited' or v_row.invite_token is null then
    raise exception 'HOLE OPEN: payment did not activate the reservation, got %', v_row;
  end if;
end $$;

-- ==========================================================================
-- 3. A claim from a caller with the WRONG phone is refused (42501) -- the
--    load-bearing anti-impersonation check.
-- ==========================================================================
do $$
declare
  v_reservation uuid := (select v from ssr_fixture where k = 'reservation');
  v_token text;
  v_wrong uuid := (select v from ssr_fixture where k = 'wrong_phone_recipient');
  v_refused boolean := false;
begin
  select invite_token into v_token from public.sponsored_service_reservations where id = v_reservation;

  perform set_config('request.jwt.claim.sub', v_wrong::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.claim_sponsored_service_reservation(v_token);
  exception when sqlstate '42501' then
    v_refused := true;
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);

  insert into ssr_result values (
    'claim with mismatched phone is refused', v_refused::text, 'true',
    case when v_refused then 'PASS' else 'FAIL' end
  );
  if not v_refused then
    raise exception 'HOLE OPEN: a caller with the WRONG phone claimed a reservation meant for someone else';
  end if;
end $$;

-- ==========================================================================
-- 4. A claim from the correct recipient (matching phone) succeeds.
-- ==========================================================================
do $$
declare
  v_reservation uuid := (select v from ssr_fixture where k = 'reservation');
  v_token text;
  v_recipient uuid := (select v from ssr_fixture where k = 'recipient');
  v_result jsonb;
  v_row public.sponsored_service_reservations%rowtype;
begin
  select invite_token into v_token from public.sponsored_service_reservations where id = v_reservation;

  perform set_config('request.jwt.claim.sub', v_recipient::text, true);
  perform set_config('role', 'authenticated', true);

  select public.claim_sponsored_service_reservation(v_token) into v_result;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);

  select * into v_row from public.sponsored_service_reservations where id = v_reservation;

  insert into ssr_result values (
    'matching-phone claim succeeds',
    coalesce(v_result->>'ok', 'null'), 'true',
    case when v_result->>'ok' = 'true' then 'PASS' else 'FAIL' end
  );
  insert into ssr_result values (
    'reservation flips to claimed',
    coalesce(v_row.status::text, 'null'), 'claimed',
    case when v_row.status = 'claimed' then 'PASS' else 'FAIL' end
  );
  insert into ssr_result values (
    'care_voucher created for the claimer',
    case when v_row.care_voucher_id is not null then 'set' else 'null' end, 'set',
    case when v_row.care_voucher_id is not null then 'PASS' else 'FAIL' end
  );

  if v_row.status is distinct from 'claimed' or v_row.care_voucher_id is null then
    raise exception 'HOLE OPEN: claim did not create a voucher / flip status correctly, got %', v_row;
  end if;
end $$;

-- ==========================================================================
-- 5. SABOTAGE: the same (already-claimed) reservation cannot be claimed
--    twice -- proves the status<>'invited' guard actually discriminates.
-- ==========================================================================
do $$
declare
  v_reservation uuid := (select v from ssr_fixture where k = 'reservation');
  v_token text;
  v_recipient uuid := (select v from ssr_fixture where k = 'recipient');
  v_refused boolean := false;
begin
  select invite_token into v_token from public.sponsored_service_reservations where id = v_reservation;

  perform set_config('request.jwt.claim.sub', v_recipient::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.claim_sponsored_service_reservation(v_token);
  exception when sqlstate '23514' then
    v_refused := true;
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);

  insert into ssr_result values (
    'SABOTAGE: double-claim of an already-claimed reservation is refused',
    v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end
  );
  if not v_refused then
    raise exception 'HOLE OPEN: a reservation was claimed twice';
  end if;
end $$;

-- ==========================================================================
-- 6. SABOTAGE: a payment of the WRONG amount does not activate a fresh
--    reservation -- proves the trigger's amount check actually blocks a
--    mismatched charge rather than trusting metadata alone.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from ssr_fixture where k = 'org');
  v_product uuid := (select v from ssr_fixture where k = 'product');
  v_sponsor uuid := (select v from ssr_fixture where k = 'sponsor');
  v_reservation2 uuid;
  v_row public.sponsored_service_reservations%rowtype;
begin
  perform set_config('request.jwt.claim.sub', v_sponsor::text, true);
  perform set_config('role', 'authenticated', true);
  select public.create_sponsored_service_reservation(v_product, '+2348012345678', 'Recipient Two') into v_reservation2;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);

  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (
    v_org, 'paystack', 'ssr-proof-ref-mismatch', 'charge.success', 1, 'NGN',
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'ssr-proof-ref-mismatch',
      'metadata', jsonb_build_object('kind', 'sponsored_service_reservation', 'reservation_id', v_reservation2::text)
    ))
  );

  select * into v_row from public.sponsored_service_reservations where id = v_reservation2;

  insert into ssr_result values (
    'SABOTAGE: amount-mismatched payment does not activate the reservation',
    coalesce(v_row.status::text, 'null'), 'pending_payment',
    case when v_row.status = 'pending_payment' then 'PASS' else 'FAIL' end
  );
  if v_row.status is distinct from 'pending_payment' then
    raise exception 'HOLE OPEN: a reservation was activated by a payment of the wrong amount, got %', v_row;
  end if;
end $$;

select check_name, observed, expected, verdict from ssr_result order by verdict desc, check_name;

rollback;
