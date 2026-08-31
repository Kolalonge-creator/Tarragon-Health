-- Care Vouchers, part 3: buying one, and paying for it in instalments.
--
-- The price is pinned server-side from panel_bundles at purchase time and then
-- frozen by the immutability trigger, so what somebody bought cannot be
-- restated later by a client, a repricing, or a bug.
--
-- Crediting rides the same no-Edge-Function-edit design the wallet used: the
-- deployed payment webhooks write every verified charge into
-- payment_transactions before branching on metadata.kind, so an AFTER INSERT
-- trigger here matches on metadata.kind = 'voucher_payment' and applies the
-- instalment. Nothing in supabase/functions/* has to change or be redeployed.

alter table public.care_voucher_config
  add column if not exists min_instalment_kobo bigint not null default 100000
    check (min_instalment_kobo > 0);

comment on column public.care_voucher_config.min_instalment_kobo is
  'Smallest single instalment toward a voucher. Default NGN 1,000 — low enough for "pay small small" to be real, high enough that card fees do not eat the payment.';

-- Who may buy a voucher for whom. profile_access is the only relationship
-- primitive left after the 2026-07-29 individual-enrolment-only removal
-- dropped family_plan_members, and private.can_fund_wallet was rewritten the
-- same way — this matches it deliberately rather than inventing a second
-- answer to the same question.
--
-- Deliberately NOT open to strangers: a gift you cannot refuse is a way to
-- push value at an account, and this keeps a purchase inside a relationship
-- the beneficiary already consented to.
create or replace function private.can_purchase_voucher_for(p_beneficiary uuid, p_purchaser uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select p_beneficiary = p_purchaser
      or exists (
        select 1 from public.profile_access pa
        where pa.profile_id = p_beneficiary and pa.grantee_user_id = p_purchaser
      );
$$;

-- ---------------------------------------------------------------------------
-- Purchase: reserve a voucher for a named service at today's catalogue price.
-- ---------------------------------------------------------------------------

create or replace function public.purchase_care_voucher(
  p_beneficiary uuid,
  p_panel_bundle_id uuid,
  p_gift_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_bundle public.panel_bundles%rowtype;
  v_id uuid;
  v_number text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not private.can_purchase_voucher_for(p_beneficiary, v_caller) then
    raise exception 'You can only buy care for yourself or someone who has linked you to their care'
      using errcode = '42501';
  end if;

  select * into v_bundle from public.panel_bundles where id = p_panel_bundle_id;
  if not found then raise exception 'that service is not in the catalogue'; end if;
  -- Only the self-bookable catalogue may be prepaid. Same guardrail
  -- enforce_lab_order_origin applies: ad hoc single tests still require a due
  -- screening or a clinician order, and a voucher must not become a way round
  -- that.
  if not v_bundle.self_bookable then
    raise exception 'that service cannot be bought directly — your care team orders it when it is due';
  end if;
  if v_bundle.price_kobo is null or v_bundle.price_kobo <= 0 then
    raise exception 'that service has no price set';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation'; end if;

  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    panel_bundle_id, sku_code, sku_name,
    face_value_kobo, status, gift_message
  ) values (
    v_org, v_number, 'prepaid_service',
    p_beneficiary, v_caller,
    v_bundle.id, v_bundle.code, v_bundle.name,
    v_bundle.price_kobo, 'reserved', nullif(trim(coalesce(p_gift_message, '')), '')
  )
  returning id into v_id;

  insert into public.care_voucher_events (organisation_id, voucher_id, event_type, actor_profile_id, note)
  values (v_org, v_id, 'created', v_caller,
          case when p_beneficiary = v_caller then 'Voucher reserved' else 'Voucher bought as a gift' end);

  return jsonb_build_object(
    'ok', true,
    'voucher_id', v_id,
    'voucher_number', v_number,
    'face_value_kobo', v_bundle.price_kobo,
    'sku_name', v_bundle.name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Layaway: record an instalment intent before sending the payer to checkout.
-- A definer RPC rather than an INSERT policy, so care_voucher_payments keeps
-- zero user write policies like every other table in this series.
-- ---------------------------------------------------------------------------

create or replace function public.record_voucher_payment_intent(
  p_voucher uuid,
  p_amount_minor bigint,
  p_currency text,
  p_credit_kobo bigint,
  p_provider public.payment_provider,
  p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_voucher public.care_vouchers%rowtype;
  v_outstanding bigint;
  v_min bigint;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_voucher from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_voucher.kind <> 'prepaid_service' then
    raise exception 'reward vouchers are not paid for';
  end if;
  if v_voucher.status <> 'reserved' then
    raise exception 'this voucher is not awaiting payment';
  end if;
  if not private.can_purchase_voucher_for(v_voucher.beneficiary_profile_id, v_caller) then
    raise exception 'You are not authorised to pay toward this voucher' using errcode = '42501';
  end if;

  select min_instalment_kobo into v_min from public.care_voucher_config where id = true;
  v_outstanding := v_voucher.face_value_kobo - v_voucher.amount_paid_kobo
                   - coalesce((select sum(credit_kobo) from public.care_voucher_payments
                               where voucher_id = p_voucher and status = 'pending'), 0);

  if p_credit_kobo <= 0 then raise exception 'instalment must be positive'; end if;
  if p_credit_kobo > v_outstanding then
    raise exception 'that is more than is outstanding on this voucher';
  end if;
  -- The final instalment may be smaller than the minimum; otherwise a
  -- remainder below the floor would be unpayable.
  if p_credit_kobo < v_min and p_credit_kobo <> v_outstanding then
    raise exception 'the smallest instalment is %', (v_min / 100)::text;
  end if;

  insert into public.care_voucher_payments (
    organisation_id, voucher_id, payer_profile_id,
    amount_minor, currency, credit_kobo, provider, pending_provider_ref, status
  ) values (
    v_voucher.organisation_id, p_voucher, v_caller,
    p_amount_minor, p_currency, p_credit_kobo, p_provider, p_reference, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply a confirmed charge. Fires once per verified webhook event, because
-- payment_transactions is idempotent on (provider, provider_event_id).
-- ---------------------------------------------------------------------------

create or replace function private.apply_voucher_payment_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_pay public.care_voucher_payments%rowtype;
  v_voucher public.care_vouchers%rowtype;
  v_new_paid bigint;
  v_months integer;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'voucher_payment' then return new; end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then return new; end if;

  select * into v_pay from public.care_voucher_payments
   where pending_provider_ref = v_ref and status = 'pending' for update;
  if not found then return new; end if;

  select * into v_voucher from public.care_vouchers where id = v_pay.voucher_id for update;
  if not found then return new; end if;

  v_new_paid := least(v_voucher.amount_paid_kobo + v_pay.credit_kobo, v_voucher.face_value_kobo);
  select validity_months into v_months from public.care_voucher_config where id = true;

  if v_new_paid >= v_voucher.face_value_kobo then
    -- Paid in full: the voucher becomes redeemable, and the expiry clock starts
    -- HERE rather than at reservation, so a long layaway never eats the
    -- validity window the patient was promised.
    update public.care_vouchers
       set amount_paid_kobo = v_new_paid,
           status = 'active',
           activated_at = now(),
           expires_at = now() + make_interval(months => v_months)
     where id = v_voucher.id;
  else
    update public.care_vouchers set amount_paid_kobo = v_new_paid where id = v_voucher.id;
  end if;

  update public.care_voucher_payments
     set status = 'applied', payment_transaction_id = new.id
   where id = v_pay.id;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values
    (v_voucher.organisation_id, v_voucher.id, 'payment_applied', v_pay.payer_profile_id,
     v_pay.credit_kobo, 'Instalment received');

  if v_new_paid >= v_voucher.face_value_kobo then
    insert into public.care_voucher_events
      (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
    values
      (v_voucher.organisation_id, v_voucher.id, 'activated', v_pay.payer_profile_id,
       v_voucher.face_value_kobo, 'Paid in full and ready to use');
  end if;

  return new;
end;
$$;

create trigger payment_transactions_apply_voucher_payment
  after insert on public.payment_transactions
  for each row execute function private.apply_voucher_payment_from_transaction();

revoke all on function public.purchase_care_voucher(uuid, uuid, text) from public;
revoke all on function public.purchase_care_voucher(uuid, uuid, text) from anon;
revoke all on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from public;
revoke all on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from anon;
grant execute on function public.purchase_care_voucher(uuid, uuid, text) to authenticated;
grant execute on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) to authenticated;

do $$
begin
  -- The anon-execute mechanism this codebase repeatedly got wrong: anon holds
  -- no direct grant, it inherits EXECUTE from the PUBLIC pseudo-role, so
  -- `revoke ... from public` is the fix and `revoke ... from anon` is a no-op.
  -- Assert rather than assume.
  if has_function_privilege('anon', 'public.purchase_care_voucher(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_voucher_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE') then
    raise exception 'anon must not be able to buy or pay for vouchers';
  end if;
  if not has_function_privilege('authenticated', 'public.purchase_care_voucher(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'authenticated must be able to buy a voucher';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payment_transactions_apply_voucher_payment') then
    raise exception 'the voucher payment trigger was not attached';
  end if;
end $$;;
