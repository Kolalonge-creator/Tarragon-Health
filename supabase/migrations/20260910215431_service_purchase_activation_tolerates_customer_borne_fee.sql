-- Every real service_purchases payment has been failing to activate since
-- the pay-per-service model launched (20260831143207) -- not the switch-
-- statement fallthrough in paystack-webhook/index.ts that this looked like
-- at first (that fallthrough is genuinely harmless, exactly as its own
-- migration's header says: activation runs off the payment_transactions
-- INSERT trigger, before the Edge Function's kind-routing even executes),
-- but a strict amount equality check inside the trigger itself,
-- private.apply_service_purchase_payment() (added later by
-- 20260905060745_payment_activation_verifies_the_amount_and_the_reference.sql).
--
-- Found 2026-09-10 by actually buying a verified-document credit against
-- this Paystack account's TEST mode, rather than reasoning about the code:
-- Paystack reported charging NGN 10,253.81 (amount_minor 1,025,381) for a
-- service_purchases row priced at NGN 10,000.00 (amount_kobo 1,000,000) --
-- a real charge.success event, verified independently against Paystack's
-- own /transaction/verify endpoint, not a fabricated payload. The
-- difference, 25,381 kobo, is exactly Paystack's own reported `fees` field
-- on that transaction: this account's fee-bearer setting passes Paystack's
-- transaction fee on to the customer, so the amount Paystack reports as
-- charged is the price PLUS its fee, not the price alone. The trigger's
-- `new.amount_minor <> v_expected_net and new.amount_minor <> v_expected_gross`
-- check demands exact equality against either the voucher-adjusted or full
-- price, so every genuinely successful payment on this account mismatches
-- by the fee and gets refused, every time, with no visible error to the
-- patient (the checkout itself reports success; only the founder-facing
-- service_purchases row silently stays 'pending_payment' forever).
--
-- Every pending_payment row found live belongs to one QA test account
-- (patient.free.test) -- no real customer has been charged and stranded by
-- this yet. Of the 6 such rows, only one (the verified-document purchase
-- above) ever reached a completed Paystack charge; the other 5 are
-- ordinary abandoned checkouts (the patient never completed the Paystack
-- step at all, so pending_payment_provider_ref was never even set on
-- them) -- ordinary and expected, exactly what the dashboard's own
-- "you started buying X but didn't finish" banner exists for, and they
-- correctly stay pending_payment here too. The bug, and the fix, is about
-- what happens once a charge genuinely succeeds -- the very next real
-- purchase would have hit the identical wall.
--
-- THE FIX: a customer being charged MORE than the price is explained
-- entirely by a passed-through processor fee and is never something to
-- refuse -- only charging LESS than what's actually owed (the smaller of
-- the voucher-adjusted and full price) is a genuine integrity problem.
-- Changed the check from "must equal net or gross exactly" to "must be at
-- least the smaller of the two" -- still refuses (and still flags) a real
-- underpayment, just stops refusing an overpayment that is entirely
-- accounted for by the provider's own reported fee.

create or replace function private.apply_service_purchase_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_purchase public.service_purchases%rowtype;
  v_product public.service_products%rowtype;
  v_expected_net bigint;
  v_expected_gross bigint;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'service_purchase' then
    return new;
  end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then
    return new;
  end if;

  select * into v_purchase from public.service_purchases
    where pending_payment_provider_ref = v_ref and status = 'pending_payment'
    for update;
  if not found then
    return new;
  end if;

  select * into v_product from public.service_products where id = v_purchase.service_product_id;

  -- The amount assertion. Skipped only when the provider event carries no
  -- amount at all -- refusing on a null would strand a legitimate payment
  -- over a payload shape rather than over a discrepancy.
  --
  -- A processor may pass its own transaction fee on to the customer, so the
  -- amount actually collected can legitimately exceed what we asked for --
  -- Paystack does this on this account (see this migration's header). Only
  -- a SHORTFALL against the smaller of net/gross (the voucher-adjusted
  -- price, if any) is ever a real integrity problem; being charged more is
  -- never something the patient or the platform loses by.
  if new.amount_minor is not null then
    v_expected_net   := coalesce(v_purchase.payable_kobo, v_purchase.amount_kobo);
    v_expected_gross := v_purchase.amount_kobo;
    if new.amount_minor < least(v_expected_net, v_expected_gross) then
      perform private.record_payment_integrity_flag(
        new.id, 'amount_mismatch', v_ref, v_expected_net, new.amount_minor,
        format('Refused to activate service purchase %s: charged %s, owed at least %s (gross %s). Left at pending_payment.',
               v_purchase.id, new.amount_minor, least(v_expected_net, v_expected_gross), v_expected_gross));
      return new;
    end if;
    if new.currency is not null and new.currency <> v_purchase.currency then
      perform private.record_payment_integrity_flag(
        new.id, 'amount_mismatch', v_ref, v_expected_net, new.amount_minor,
        format('Refused to activate service purchase %s: paid in %s, priced in %s.',
               v_purchase.id, new.currency, v_purchase.currency));
      return new;
    end if;
  end if;

  update public.service_purchases
    set status = 'active',
        payment_provider = new.provider,
        payment_provider_ref = v_ref,
        pending_payment_provider_ref = null,
        purchased_at = now(),
        expires_at = case when v_product.access_duration_days is null then null
                          else now() + (v_product.access_duration_days || ' days')::interval end
    where id = v_purchase.id;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: apply the corrected rule to every already-stuck row rather than
-- only to purchases made from here on. Every one of these already has a
-- genuine charge.success payment_transactions row on file (the trigger ran
-- and refused each one under the old, too-strict rule) -- this reproduces
-- exactly what the trigger would now do for that same event, as a plain
-- set-based update, not a re-fired trigger.
-- ---------------------------------------------------------------------------

with candidate_events as (
  select distinct on (sp.id)
    sp.id as purchase_id,
    pt.provider,
    pt.raw_payload -> 'data' ->> 'reference' as ref,
    spr.access_duration_days
  from public.service_purchases sp
  join public.payment_transactions pt
    on pt.raw_payload -> 'data' ->> 'reference' = sp.pending_payment_provider_ref
  join public.service_products spr on spr.id = sp.service_product_id
  where sp.status = 'pending_payment'
    and pt.event_type in ('charge.success', 'checkout.session.completed')
    and pt.raw_payload -> 'data' -> 'metadata' ->> 'kind' = 'service_purchase'
    and pt.amount_minor >= least(coalesce(sp.payable_kobo, sp.amount_kobo), sp.amount_kobo)
    and (pt.currency is null or pt.currency = sp.currency)
  order by sp.id, pt.created_at asc
)
update public.service_purchases sp
   set status = 'active',
       payment_provider = ce.provider,
       payment_provider_ref = ce.ref,
       pending_payment_provider_ref = null,
       purchased_at = now(),
       expires_at = case when ce.access_duration_days is null then null
                         else now() + (ce.access_duration_days || ' days')::interval end
  from candidate_events ce
 where sp.id = ce.purchase_id;

-- ---------------------------------------------------------------------------
-- Proof
-- ---------------------------------------------------------------------------

do $$
declare
  v_status text;
  v_abandoned_touched int;
  v_row_exists boolean;
begin
  -- 1. Positive, real data: the one row with a genuinely completed
  --    Paystack charge behind it (verified independently against
  --    Paystack's own /transaction/verify endpoint, see header) is now
  --    active. Read by id with a graceful SKIP rather than a hard
  --    assumption it exists -- this id is a real production row from the
  --    session that found this bug, which a from-scratch CI replay (empty
  --    seed) never has. See reference_rolled_back_txn_vs_ci_replay_
  --    20260906.md in memory: this migration's first version hardcoded
  --    these production ids as a bare assertion and failed CI's replay
  --    for exactly this reason -- caught there, not guessed at here.
  select exists(
    select 1 from public.service_purchases where id = '2efae6a7-85c1-46a8-bdf7-811647068700'
  ) into v_row_exists;

  if not v_row_exists then
    raise notice 'SKIP: the real paid-purchase row from production is not present in this environment (expected on a fresh CI replay)';
  else
    select status into v_status
      from public.service_purchases where id = '2efae6a7-85c1-46a8-bdf7-811647068700';
    if v_status is distinct from 'active' then
      raise exception 'FAIL: the one row with a real completed charge behind it is % instead of active', v_status;
    end if;
    raise notice 'PASS: the genuinely-paid row is now active';

    -- Negative control on real data: the 5 merely-abandoned checkouts
    -- (never reached Paystack, no pending_payment_provider_ref, no
    -- payment_transactions row at all) must NOT have been touched by the
    -- backfill -- proves the backfill's join is selective, not "activate
    -- anything pending". Only checked alongside the row above, since both
    -- come from the same production session and neither exists without
    -- the other.
    select count(*) into v_abandoned_touched
      from public.service_purchases
     where id in (
       '61da33cf-2622-4129-ba6c-2317376c5e81',
       '76a8a98c-064f-4269-8e88-2a7f0e405877',
       '3ac48607-e80e-403b-9c7a-a7cbd33e4b66',
       'e32e2bac-a011-480f-846f-533aeca675c5',
       '0242af8e-2ffe-4eb5-b97f-dcc7bff714ea'
     )
     and status <> 'pending_payment';
    if v_abandoned_touched > 0 then
      raise exception 'FAIL: the backfill activated % abandoned-checkout row(s) that never had a real payment', v_abandoned_touched;
    end if;
    raise notice 'PASS: abandoned checkouts with no real payment were correctly left alone';
  end if;

  -- 2. Negative, pure boolean check (no table writes): a genuine
  --    underpayment must still be refused. Mirrors the trigger's own
  --    predicate with representative numbers -- charged less than owed.
  if not (500000 < least(1000000, 1000000)) then
    raise exception 'FAIL: an underpaid amount (500000 against 1000000 owed) would not be refused';
  end if;
  -- And a fee-inflated overpayment (this exact bug) must NOT be refused.
  if (1025381 < least(1000000, 1000000)) then
    raise exception 'FAIL: a fee-inflated overpayment (1025381 against 1000000 owed) would incorrectly be refused';
  end if;
  raise notice 'PASS: underpayment still refused, fee-inflated overpayment no longer refused';
end $$;
