-- ===========================================================================
-- Verification: 20260905060745_payment_activation_verifies_the_amount_and_the
--               _reference
--
-- THE GAPS. Nothing in the payment path compared what was charged against
-- what was owed. private.apply_service_purchase_payment() activated a
-- service_purchases row on a reference match alone, never looking at
-- amount_minor. private.activate_sponsored_service_purchase() was worse: it
-- granted whatever plan_code the checkout METADATA named, correlated only on
-- beneficiary_profile_id plus a profile_access grant -- no provider
-- reference, so no idempotency against a webhook retry -- and RESET an
-- existing active purchase's expires_at to now()+duration, which shortened
-- access a patient had already paid for.
--
-- This script proves, against the real trigger chain:
--   * a 100 kobo payment for a full-price purchase no longer activates it,
--     raises a payment_reconciliation_flags amount_mismatch row, and tells
--     every admin;
--   * CONTROL: paying exactly what is owed still activates and flags nothing;
--   * a sponsored charge with no provider reference grants nothing;
--   * a sponsored underpayment grants nothing and is flagged;
--   * a correctly-priced sponsored charge grants and records its reference;
--   * replaying that same reference does not buy a second window;
--   * a genuinely new second charge EXTENDS the window by the product's
--     duration rather than resetting it;
--   * SABOTAGE x2: reverting `greatest(expires_at, now())` to `now()` makes
--     the window shorten again, and neutering the amount comparison lets the
--     100 kobo payment through again.
--
-- Wrapped in BEGIN/ROLLBACK -- it mutates a real pending purchase row, grants
-- a profile_access, and redefines two triggers; the rollback undoes all of it.
-- ===========================================================================

begin;
create temporary table p3(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table p3f(k text primary key, v text) on commit drop;

do $$
declare v_org uuid; v_pur uuid; v_prod uuid; v_ben uuid; v_spon uuid; v_owed bigint;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'no organisation available -- cannot run this test'; end if;
  select id into v_prod from public.service_products
    where access_duration_days is not null and price_kobo > 0 and is_active order by code limit 1;
  if v_prod is null then raise exception 'no priced, time-bounded service_product to test against'; end if;
  select id into v_pur from public.service_purchases where status = 'pending_payment' order by created_at limit 1;
  if v_pur is null then raise exception 'no pending_payment service_purchases row to test against'; end if;
  select id into v_ben from public.profiles where role = 'patient' order by created_at limit 1;
  select id into v_spon from public.profiles where role = 'patient' and id <> v_ben order by created_at limit 1;
  if v_ben is null or v_spon is null then raise exception 'need two patient profiles for the sponsor case'; end if;
  select payable_kobo into v_owed from public.service_purchases where id = v_pur;
  insert into p3f values ('org', v_org::text), ('prod', v_prod::text), ('pur', v_pur::text),
                         ('ben', v_ben::text), ('spon', v_spon::text), ('owed', v_owed::text);
end $$;

-- ============ 1. An underpayment is refused and flagged ====================
do $$
declare v_org uuid := (select v from p3f where k='org')::uuid;
        v_pur uuid := (select v from p3f where k='pur')::uuid;
        v_owed bigint := (select v from p3f where k='owed')::bigint;
        v_status text; v_flags int; v_notifs int; v_admins int;
begin
  update public.service_purchases set pending_payment_provider_ref = 'p3-under' where id = v_pur;

  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-under', 'charge.success', 100, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object(
            'reference','p3-under','metadata', jsonb_build_object('kind','service_purchase'))));

  select status::text into v_status from public.service_purchases where id = v_pur;
  insert into p3 values
    ('paying 100 kobo for a ' || v_owed || ' kobo purchase no longer activates it',
     v_status, 'pending_payment', case when v_status = 'pending_payment' then 'PASS' else 'FAIL' end);
  if v_status <> 'pending_payment' then
    raise exception 'HOLE OPEN: an underpayment still activated the purchase (status=%)', v_status;
  end if;

  select count(*) into v_flags from public.payment_reconciliation_flags
   where provider_reference = 'p3-under' and flag_type = 'amount_mismatch';
  insert into p3 values
    ('the refusal raises a payment_reconciliation_flags amount_mismatch row',
     v_flags::text, '1', case when v_flags = 1 then 'PASS' else 'FAIL' end);
  if v_flags <> 1 then raise exception 'HOLE OPEN: refusal raised % flags', v_flags; end if;

  select count(*) into v_admins from public.profiles where role = 'admin';
  select count(*) into v_notifs from public.notifications
   where template = 'payment_integrity_flag_raised' and payload->>'provider_reference' = 'p3-under';
  insert into p3 values
    ('every admin is told about the refused activation',
     v_notifs::text, v_admins::text, case when v_notifs = v_admins then 'PASS' else 'FAIL' end);
  if v_notifs <> v_admins then raise exception 'HOLE OPEN: % admin notifications', v_notifs; end if;
end $$;

-- ============ 2. CONTROL: the correct amount still activates ===============
do $$
declare v_org uuid := (select v from p3f where k='org')::uuid;
        v_pur uuid := (select v from p3f where k='pur')::uuid;
        v_owed bigint := (select v from p3f where k='owed')::bigint;
        v_status text; v_ref text; v_flags int;
begin
  update public.service_purchases set pending_payment_provider_ref = 'p3-ok' where id = v_pur;

  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-ok', 'charge.success', v_owed, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object(
            'reference','p3-ok','metadata', jsonb_build_object('kind','service_purchase'))));

  select status::text, payment_provider_ref into v_status, v_ref
    from public.service_purchases where id = v_pur;
  select count(*) into v_flags from public.payment_reconciliation_flags where provider_reference = 'p3-ok';
  insert into p3 values
    ('CONTROL: paying exactly what is owed activates the purchase and flags nothing',
     v_status || ' ref=' || coalesce(v_ref,'<null>') || ' flags=' || v_flags,
     'active ref=p3-ok flags=0',
     case when v_status = 'active' and v_ref = 'p3-ok' and v_flags = 0 then 'PASS' else 'FAIL' end);
  if v_status <> 'active' or v_flags <> 0 then
    raise exception 'REGRESSION: a correct payment was refused (status=% flags=%)', v_status, v_flags;
  end if;
end $$;

-- ============ 3. Sponsored: reference required, amount checked =============
do $$
declare v_org uuid := (select v from p3f where k='org')::uuid;
        v_prod uuid := (select v from p3f where k='prod')::uuid;
        v_ben uuid := (select v from p3f where k='ben')::uuid;
        v_spon uuid := (select v from p3f where k='spon')::uuid;
        v_code text; v_price bigint; v_days int; v_granted int; v_flags int;
begin
  select code, price_kobo, access_duration_days into v_code, v_price, v_days
    from public.service_products where id = v_prod;
  insert into p3f values ('code', v_code), ('price', v_price::text), ('days', v_days::text);

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_ben, v_spon, 'manage', v_ben)
  on conflict do nothing;

  -- 3a. No provider reference at all -> refused and flagged.
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-spon-noref', 'charge.success', v_price, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object('metadata', jsonb_build_object(
            'kind','sponsored_subscription','plan_code',v_code,
            'beneficiary_profile_id',v_ben::text,'sponsor_profile_id',v_spon::text))));

  select count(*) into v_granted from public.service_purchases
   where patient_id = v_ben and service_product_id = v_prod and status = 'active';
  insert into p3 values
    ('a sponsored charge carrying no provider reference grants nothing',
     v_granted::text, '0', case when v_granted = 0 then 'PASS' else 'FAIL' end);
  if v_granted <> 0 then raise exception 'HOLE OPEN: granted without a reference'; end if;

  -- 3b. Underpaid -> refused and flagged.
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-spon-under', 'charge.success', 100, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object('reference','p3-spon-under','metadata', jsonb_build_object(
            'kind','sponsored_subscription','plan_code',v_code,
            'beneficiary_profile_id',v_ben::text,'sponsor_profile_id',v_spon::text))));

  select count(*) into v_granted from public.service_purchases
   where patient_id = v_ben and service_product_id = v_prod and status = 'active';
  select count(*) into v_flags from public.payment_reconciliation_flags
   where provider_reference = 'p3-spon-under' and flag_type = 'amount_mismatch';
  insert into p3 values
    ('a sponsored charge of 100 kobo for a ' || v_price || ' kobo product grants nothing and is flagged',
     'granted=' || v_granted || ' flags=' || v_flags, 'granted=0 flags=1',
     case when v_granted = 0 and v_flags = 1 then 'PASS' else 'FAIL' end);
  if v_granted <> 0 or v_flags <> 1 then
    raise exception 'HOLE OPEN: sponsored underpayment granted=% flags=%', v_granted, v_flags;
  end if;
end $$;

-- ============ 4. Sponsored: a correct charge grants, once ==================
do $$
declare v_org uuid := (select v from p3f where k='org')::uuid;
        v_prod uuid := (select v from p3f where k='prod')::uuid;
        v_ben uuid := (select v from p3f where k='ben')::uuid;
        v_code text := (select v from p3f where k='code');
        v_price bigint := (select v from p3f where k='price')::bigint;
        v_spon uuid := (select v from p3f where k='spon')::uuid;
        v_granted int; v_ref text;
begin
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-spon-ok', 'charge.success', v_price, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object('reference','p3-spon-ok','metadata', jsonb_build_object(
            'kind','sponsored_subscription','plan_code',v_code,
            'beneficiary_profile_id',v_ben::text,'sponsor_profile_id',v_spon::text))));

  select count(*), max(payment_provider_ref) into v_granted, v_ref
    from public.service_purchases
   where patient_id = v_ben and service_product_id = v_prod and status = 'active';
  insert into p3 values
    ('a correctly-priced sponsored charge grants access and records the provider reference',
     'granted=' || v_granted || ' ref=' || coalesce(v_ref,'<null>'), 'granted=1 ref=p3-spon-ok',
     case when v_granted = 1 and v_ref = 'p3-spon-ok' then 'PASS' else 'FAIL' end);
  if v_granted <> 1 or v_ref is distinct from 'p3-spon-ok' then
    raise exception 'HOLE OPEN: sponsored grant=% ref=%', v_granted, v_ref;
  end if;
  insert into p3f values ('spon_purchase',
    (select id::text from public.service_purchases
      where patient_id = v_ben and service_product_id = v_prod and status = 'active' limit 1));
end $$;

-- ============ 5. Sponsored: a webhook retry does not buy a second window ===
do $$
declare v_org uuid := (select v from p3f where k='org')::uuid;
        v_sp uuid := (select v from p3f where k='spon_purchase')::uuid;
        v_ben uuid := (select v from p3f where k='ben')::uuid;
        v_spon uuid := (select v from p3f where k='spon')::uuid;
        v_code text := (select v from p3f where k='code');
        v_price bigint := (select v from p3f where k='price')::bigint;
        v_before timestamptz; v_after timestamptz;
begin
  select expires_at into v_before from public.service_purchases where id = v_sp;

  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-spon-ok-retry', 'charge.success', v_price, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object('reference','p3-spon-ok','metadata', jsonb_build_object(
            'kind','sponsored_subscription','plan_code',v_code,
            'beneficiary_profile_id',v_ben::text,'sponsor_profile_id',v_spon::text))));

  select expires_at into v_after from public.service_purchases where id = v_sp;
  insert into p3 values
    ('replaying the SAME provider reference does not extend the window again',
     case when v_after = v_before then 'unchanged' else 'moved' end, 'unchanged',
     case when v_after = v_before then 'PASS' else 'FAIL' end);
  if v_after <> v_before then
    raise exception 'HOLE OPEN: a replayed charge bought a second window (% -> %)', v_before, v_after;
  end if;
end $$;

-- ============ 6. Sponsored: a SECOND charge EXTENDS, never shortens ========
do $$
declare v_org uuid := (select v from p3f where k='org')::uuid;
        v_sp uuid := (select v from p3f where k='spon_purchase')::uuid;
        v_ben uuid := (select v from p3f where k='ben')::uuid;
        v_spon uuid := (select v from p3f where k='spon')::uuid;
        v_code text := (select v from p3f where k='code');
        v_price bigint := (select v from p3f where k='price')::bigint;
        v_days int := (select v from p3f where k='days')::int;
        v_before timestamptz; v_after timestamptz; v_expected timestamptz;
begin
  select expires_at into v_before from public.service_purchases where id = v_sp;
  v_expected := v_before + (v_days || ' days')::interval;

  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-spon-second', 'charge.success', v_price, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object('reference','p3-spon-second','metadata', jsonb_build_object(
            'kind','sponsored_subscription','plan_code',v_code,
            'beneficiary_profile_id',v_ben::text,'sponsor_profile_id',v_spon::text))));

  select expires_at into v_after from public.service_purchases where id = v_sp;
  insert into p3 values
    ('a second sponsored charge EXTENDS the paid-for window rather than resetting it',
     'delta_days=' || round(extract(epoch from (v_after - v_before)) / 86400)::text,
     'delta_days=' || v_days::text,
     case when v_after between v_expected - interval '1 minute' and v_expected + interval '1 minute'
          then 'PASS' else 'FAIL' end);
  if v_after < v_before then
    raise exception 'HOLE OPEN: a second payment SHORTENED access (% -> %)', v_before, v_after;
  end if;
  if v_after not between v_expected - interval '1 minute' and v_expected + interval '1 minute' then
    raise exception 'FAIL: expected % got %', v_expected, v_after;
  end if;
end $$;

-- ============ 7. SABOTAGE: reset-instead-of-extend shortens access again ===
do $$
declare v_org uuid := (select v from p3f where k='org')::uuid;
        v_sp uuid := (select v from p3f where k='spon_purchase')::uuid;
        v_ben uuid := (select v from p3f where k='ben')::uuid;
        v_spon uuid := (select v from p3f where k='spon')::uuid;
        v_code text := (select v from p3f where k='code');
        v_price bigint := (select v from p3f where k='price')::bigint;
        v_before timestamptz; v_after timestamptz; v_def text;
begin
  v_def := pg_get_functiondef('private.activate_sponsored_service_purchase()'::regprocedure);
  if v_def not like '%greatest(v_existing.expires_at, now())%' then
    raise exception 'SABOTAGE SETUP FAILED: the extend expression this test patches is gone';
  end if;
  execute replace(v_def, 'greatest(v_existing.expires_at, now())', 'now()');

  select expires_at into v_before from public.service_purchases where id = v_sp;

  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-sabotage', 'charge.success', v_price, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object('reference','p3-sabotage','metadata', jsonb_build_object(
            'kind','sponsored_subscription','plan_code',v_code,
            'beneficiary_profile_id',v_ben::text,'sponsor_profile_id',v_spon::text))));

  select expires_at into v_after from public.service_purchases where id = v_sp;
  insert into p3 values
    ('SABOTAGE: with `now()` back in place of `greatest(expires_at, now())` the window SHORTENS',
     case when v_after < v_before then 'shortened' else 'not shortened' end, 'shortened',
     case when v_after < v_before then 'PASS' else 'FAIL' end);
  if v_after >= v_before then
    raise exception 'VACUOUS TEST: reverting the extend expression did not shorten the window -- section 6 proves nothing';
  end if;
end $$;

-- ============ 8. SABOTAGE: the amount check is what refuses ================
do $$
declare v_org uuid := (select v from p3f where k='org')::uuid;
        v_pur uuid := (select v from p3f where k='pur')::uuid;
        v_status text; v_def text;
begin
  v_def := pg_get_functiondef('private.apply_service_purchase_payment()'::regprocedure);
  execute replace(v_def,
    'if new.amount_minor <> v_expected_net and new.amount_minor <> v_expected_gross then',
    'if false then');

  update public.service_purchases
     set status = 'pending_payment', payment_provider_ref = null,
         pending_payment_provider_ref = 'p3-sab-amount', purchased_at = null
   where id = v_pur;

  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p3-sab-amount', 'charge.success', 100, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object(
            'reference','p3-sab-amount','metadata', jsonb_build_object('kind','service_purchase'))));

  select status::text into v_status from public.service_purchases where id = v_pur;
  insert into p3 values
    ('SABOTAGE: neutering the amount comparison lets the 100 kobo payment activate again',
     v_status, 'active', case when v_status = 'active' then 'PASS' else 'FAIL' end);
  if v_status <> 'active' then
    raise exception 'VACUOUS TEST: the underpayment was refused even with the amount check neutered -- section 1 proves nothing';
  end if;
end $$;

select check_name, observed, expected, verdict from p3 order by check_name;
rollback;
