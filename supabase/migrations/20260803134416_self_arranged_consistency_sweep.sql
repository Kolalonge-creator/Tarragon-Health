-- Consistency sweep: three paths still assumed Tarragon books and bills a test.
--
-- Found by auditing every function that writes lab_orders after the
-- self-arranged guard went in. Row counts first: lab_orders 0, care_vouchers 0,
-- so nothing needs unwinding and nobody has been charged.

-- ---------------------------------------------------------------------------
-- 1. sponsor_book_care was BROKEN, not merely stale.
--
-- It inserted status='pending_payment' with a price, a facility and a provider
-- — all four of which enforce_lab_order_origin now rejects — so a supporter
-- booking a check for their mother got a raw 23514.
--
-- A supporter can still do the useful half: say "she needs her diabetes check"
-- and have the request issued. What they can no longer do is pay for the test
-- through us, because we do not take payment for tests any more. The money for
-- the test goes to the laboratory, from whoever is standing in it.
-- ---------------------------------------------------------------------------
create or replace function public.sponsor_book_care(
  p_beneficiary uuid,
  p_bundle_code text,
  -- Accepted and ignored: retained so existing callers keep compiling. There is
  -- no facility to choose because there is no partner to route to.
  p_facility_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_org    uuid;
  v_bundle uuid;
  v_order  uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.permission_level = 'manage'
  ) then
    raise exception 'you do not have permission to book care for this person'
      using errcode = '42501';
  end if;

  -- Only ever the self-bookable catalogue. Same narrow door the patient's own
  -- booking card uses, not a general ordering power.
  select pb.id into v_bundle
    from public.panel_bundles pb
   where pb.code = p_bundle_code and pb.self_bookable;
  if v_bundle is null then
    raise exception 'that check is not available to request directly' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation on file'; end if;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin, panel_bundle_id, fulfilment)
  values
    (v_org, p_beneficiary, 'ordered', 0, 'patient_initiated', v_bundle, 'self_arranged')
  returning id into v_order;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order,
    'self_arranged', true,
    'paid', false
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. purchase_care_voucher would have sold something undeliverable.
--
-- Every prepaid voucher is a panel_bundle (the bundle id is a required
-- argument), so somebody could still pay Tarragon a full Screen price for a
-- test Tarragon no longer performs or bills, against an order that is now ₦0
-- and never pending_payment. The voucher could never be redeemed. Taking money
-- for that is the single worst thing in this sweep, so it fails closed with a
-- message that says what to do instead.
--
-- ⚠️ FOUNDER: this leaves the prepaid-service voucher with NO purchasable SKU.
-- Its replacement for a sponsor is the sponsored subscription
-- (subscriptions.paid_by_profile_id), which is real and working. Reward
-- vouchers (private.issue_reward_voucher, kind='reward_discount') are a
-- separate liability and are untouched.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_care_voucher(
  p_beneficiary uuid,
  p_panel_bundle_id uuid,
  p_gift_message text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  raise exception 'Tests are paid straight to the laboratory, so there is nothing for us to hold on your behalf. To help someone with their care, pay for their plan instead, or send them what the test will cost.'
    using errcode = '23514';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. set_lab_order_facility is partner-only and now says so.
--
-- It requires status='pending_payment' (a self-arranged order never is) and
-- sets facility_id + provider_id (both rejected). Left in place for the dormant
-- partner path, but it must fail with an explanation rather than a confusing
-- constraint error. Its UI (ChooseLabFacility) is removed in the same change.
-- ---------------------------------------------------------------------------
create or replace function public.set_lab_order_facility(p_order_id uuid, p_facility_id uuid)
returns public.lab_orders
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.lab_orders%rowtype;
  v_facility public.facilities%rowtype;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Lab order not found' using errcode = '42501';
  end if;

  if v_order.fulfilment = 'self_arranged' then
    raise exception 'This request is yours to take to any laboratory you like, so there is no facility to set here'
      using errcode = '23514';
  end if;

  if v_order.patient_id is distinct from (select auth.uid()) and not private.is_org_staff(v_order.organisation_id) then
    raise exception 'Not authorised to update this lab order' using errcode = '42501';
  end if;

  if v_order.facility_id is not null then
    raise exception 'This order already has a facility chosen' using errcode = '23514';
  end if;

  if v_order.status <> 'pending_payment' then
    raise exception 'A facility can only be chosen before payment' using errcode = '23514';
  end if;

  select * into v_facility from public.facilities where id = p_facility_id and is_active;
  if v_facility.id is null then
    raise exception 'Facility not found' using errcode = '23514';
  end if;
  if v_facility.lab_provider_id is null then
    raise exception 'This facility cannot take lab bookings yet' using errcode = '23514';
  end if;

  update public.lab_orders
    set facility_id = p_facility_id, provider_id = v_facility.lab_provider_id
    where id = p_order_id
    returning * into v_order;

  return v_order;
end;
$function$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname='sponsor_book_care' and pronamespace='public'::regnamespace;
  if v_def like '%pending_payment%' or v_def like '%provider_id%' then
    raise exception 'sponsor_book_care still writes a partner-shaped order';
  end if;
  if v_def not like '%self_arranged%' then
    raise exception 'sponsor_book_care does not issue a self-arranged order';
  end if;

  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname='purchase_care_voucher' and pronamespace='public'::regnamespace;
  if v_def like '%insert into public.care_vouchers%' then
    raise exception 'purchase_care_voucher can still sell an unfulfillable prepaid service';
  end if;

  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname='set_lab_order_facility' and pronamespace='public'::regnamespace;
  if v_def not like '%no facility to set here%' then
    raise exception 'set_lab_order_facility does not explain itself on a self-arranged order';
  end if;

  -- anon must not have gained execute on any of the three.
  if has_function_privilege('anon', 'public.sponsor_book_care(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.purchase_care_voucher(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_lab_order_facility(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon can execute one of the rewritten RPCs';
  end if;
end $$;
