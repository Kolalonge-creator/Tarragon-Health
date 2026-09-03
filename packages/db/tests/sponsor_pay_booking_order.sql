-- Proves public.sponsor_pay_booking_order lets exactly the right person pay,
-- and nobody else.
--
-- The distinction being defended is the one the whole consent model rests on:
-- a 'view' grantee follows a record, a 'manage' grantee acts on it. Settling a
-- bill is acting. A next of kin naming themselves must not thereby gain the
-- ability to move someone else's wallet balance, even though that balance can
-- only ever be spent on that same person's care.
--
-- Rolled back. Fixtures resolved at runtime so it runs anywhere.
--
--   1. A 'view' grantee is refused (42501).
--   2. Someone with no grant at all is refused (42501).
--   3. A 'manage' grantee succeeds: order flips to payment_confirmed, the
--      beneficiary's wallet is debited by exactly the order total, and the
--      ledger records the SPONSOR as the actor, not the patient.
--   4. Naming the wrong beneficiary for a real order is refused, so the grant
--      cannot be used as a lever onto somebody else's order.
--   5. Paying an order that is no longer awaiting payment is refused.
begin;

do $$
declare
  v_org        uuid;
  v_owner      uuid;
  v_manager    uuid;
  v_viewer     uuid;
  v_stranger   uuid;
  v_wallet     uuid;
  v_bundle     uuid;
  v_price      bigint;
  v_order      uuid;
  v_status     text;
  v_balance    bigint;
  v_actor      uuid;
  v_ok         boolean;
begin
  select id, organisation_id into v_owner, v_org
    from public.profiles where role = 'patient' order by created_at limit 1;
  select id into v_manager
    from public.profiles where role = 'patient' and id <> v_owner order by created_at limit 1;
  select id into v_viewer
    from public.profiles where role = 'patient' and id not in (v_owner, v_manager)
    order by created_at limit 1;
  select id into v_stranger
    from public.profiles where role = 'patient' and id not in (v_owner, v_manager, v_viewer)
    order by created_at limit 1;

  if v_stranger is null then
    raise exception 'need four patient profiles to run this test';
  end if;

  select id, price_kobo into v_bundle, v_price
    from public.panel_bundles where self_bookable and price_kobo > 0 order by price_kobo limit 1;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_manager, 'manage', v_owner), (v_owner, v_viewer, 'view', v_owner)
  on conflict do nothing;

  insert into public.health_wallets (organisation_id, profile_id, balance_kobo)
  values (v_org, v_owner, v_price * 3)
  on conflict (profile_id) do update set balance_kobo = excluded.balance_kobo
  returning id into v_wallet;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin, panel_bundle_id)
  values (v_org, v_owner, 'pending_payment', v_price, 'patient_initiated', v_bundle)
  returning id into v_order;

  ---------------------------------------------------------------- 1. view
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.sponsor_pay_booking_order(v_owner, 'lab', v_order);
    raise exception 'FAIL 1: a view grantee was allowed to pay';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 2. stranger
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.sponsor_pay_booking_order(v_owner, 'lab', v_order);
    raise exception 'FAIL 2: someone with no grant was allowed to pay';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 4. mismatch
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    -- Real grant, real order, but the order belongs to v_owner not v_manager.
    perform public.sponsor_pay_booking_order(v_manager, 'lab', v_order);
    raise exception 'FAIL 4: a mismatched beneficiary was accepted';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 3. manage
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select (public.sponsor_pay_booking_order(v_owner, 'lab', v_order)->>'ok')::boolean into v_ok;
  perform set_config('role', 'postgres', true);

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 3: the manage grantee could not pay';
  end if;

  select status::text into v_status from public.lab_orders where id = v_order;
  if v_status <> 'payment_confirmed' then
    raise exception 'FAIL 3: order status is %, expected payment_confirmed', v_status;
  end if;

  select balance_kobo into v_balance from public.health_wallets where id = v_wallet;
  if v_balance <> v_price * 2 then
    raise exception 'FAIL 3: balance is %, expected % after one order of %',
      v_balance, v_price * 2, v_price;
  end if;

  select actor_profile_id into v_actor
    from public.wallet_ledger
   where wallet_id = v_wallet and entry_type = 'spend'
   order by created_at desc limit 1;
  if v_actor <> v_manager then
    raise exception 'FAIL 3: ledger actor is %, expected the sponsor %', v_actor, v_manager;
  end if;

  ---------------------------------------------------------------- 5. already paid
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.sponsor_pay_booking_order(v_owner, 'lab', v_order);
    raise exception 'FAIL 5: an already-paid order was paid twice';
  exception when others then
    if sqlerrm like 'FAIL 5%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: view refused, stranger refused, mismatch refused, manage paid % kobo, double-pay refused',
    v_price;
end $$;

rollback;
