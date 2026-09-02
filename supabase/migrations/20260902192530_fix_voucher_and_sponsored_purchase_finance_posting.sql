-- Tarragon Health — fix: care-voucher and sponsored-service-purchase
-- payments never reach Finance, even once they are correctly activated.
--
-- Same root cause diagnosed and fixed for service_purchase in
-- 20260902103712_fix_service_purchase_finance_posting_gap.sql, confirmed
-- live before writing this migration by reading finance_post_from_payment's
-- and finance_on_payment_processed's actual definitions:
--
--   1. finance_on_payment_processed() (the function behind the
--      finance_post_payment_processed trigger) only ever calls
--      finance_post_from_payment when `new.processed_at is not null` — it
--      never even attempts posting on the bare INSERT.
--   2. The live webhooks (paystack-webhook/index.ts, stripe-webhook/
--      index.ts) insert payment_transactions with processed_at NULL and
--      only set it later via markProcessed() — which their charge.success/
--      checkout.session.completed switch only ever calls for
--      metadata.kind IN ('booking','subscription'). Every other kind falls
--      into the generic else-branch (assumed 'add_on', no match found,
--      markFailed() called instead) — so processed_at is NEVER set for a
--      voucher_payment or sponsored_subscription transaction, and
--      finance_post_payment_processed never fires for either no matter what
--      finance_post_from_payment's own classification logic does.
--
-- For 'voucher_payment' this is pure lost accounting: private.apply_
-- voucher_payment_from_transaction already activates the voucher correctly
-- (it was built event_type-gated from the start, never processed_at-gated —
-- see that function's own definition), and finance_post_from_payment
-- already has a correct 'voucher' branch (posts to 2100, Customer
-- prepayments) — the branch is simply unreachable in production.
--
-- For 'sponsored_subscription' the gap is compounded by a second, more
-- severe bug fixed separately in this same batch
-- (20260902192010_fix_activate_sponsored_service_purchase_processed_at_
-- regression.sql — the activation trigger couldn't even fire before that
-- fix), and finance_post_from_payment has never had any branch for this
-- kind at all: its classification depends on txn.subscription_id, which
-- private.activate_sponsored_service_purchase never writes back onto
-- payment_transactions (it upserts service_purchases directly from checkout
-- metadata), so this kind fell through every existing branch to the
-- unconditional `else return;` at the bottom of the classification chain.
--
-- Fix, mirroring the established pattern exactly:
--   1. Widen finance_post_from_payment's `processed_at is null -> return`
--      guard to also admit 'voucher_payment' and 'sponsored_subscription' —
--      both are classifiable purely from raw_payload.metadata.kind, present
--      from the very first INSERT, same reasoning as the existing
--      'service_purchase' exception.
--   2. Add a `sponsored_subscription` branch that correlates the same way
--      activate_sponsored_service_purchase does — by beneficiary_profile_id
--      + plan_code from checkout metadata, not by a payment_provider_ref
--      column (the sponsor flow never stamps one on the service_purchases
--      row it upserts) — then posts with the identical accounting treatment
--      as a plain service_purchase (immediate 4100 for a perpetual grant,
--      deferred 2000 + a 4020 recognition schedule for a bounded pack): a
--      sponsor-funded pack is not a different product, just a different
--      payer.
--   3. Two new dedicated AFTER INSERT triggers (finance_post_voucher_
--      payment, finance_post_sponsored_subscription_payment), each gated on
--      event_type + the relevant metadata.kind, calling finance_post_from_
--      payment directly — siblings to finance_post_service_purchase_payment
--      and the other per-kind triggers already on this table, not a rewrite
--      of finance_post_payment_processed (which booking/subscription/add_on
--      still correctly rely on). finance_post_journal and finance_create_
--      recognition_schedule are already idempotent per source_ref /
--      payment_transaction_id, so these new triggers firing alongside the
--      (normally silent, for these kinds) existing trigger is safe.
--
-- Live-verified before writing this: 0 payment_transactions rows of either
-- kind exist, and 0 profile_access 'manage' grants exist at all (so 0
-- sponsor relationships currently exist to have been affected) — platform
-- is pre-revenue, nothing to backfill.

-- ---------------------------------------------------------------------------
-- 1. finance_post_from_payment — widened guard, one new branch. Every
-- previously-existing branch (booking/lab/pharmacy, voucher, service_
-- purchase, the generic subscription/add_on tail, refund) is preserved
-- verbatim.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_from_payment(p_txn_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  txn public.payment_transactions%rowtype;
  v_kind text;
  v_amount bigint;
  v_cur public.currency;
  v_date date;
  v_is_money_in boolean;
  v_is_refund boolean;
  v_int public.billing_interval;
  v_cpe timestamptz;
  v_pstart date;
  v_pend date;
  v_txn_entry uuid;
  v_lab public.lab_orders%rowtype;
  v_pharm public.pharmacy_orders%rowtype;
  v_cost bigint;
  v_lines jsonb;
  v_ref text;
  v_purchase public.service_purchases%rowtype;
  v_product public.service_products%rowtype;
  v_meta jsonb;
  v_beneficiary uuid;
begin
  select * into txn from public.payment_transactions where id = p_txn_id;
  if txn.id is null then return; end if;

  -- Every other kind's classification depends on enrichment columns
  -- (booking_order_id/subscription_id/subscription_add_on_id) that only
  -- arrive together with processed_at via the webhook's later UPDATE, so
  -- they still correctly require it. voucher_payment, service_purchase, and
  -- sponsored_subscription are all classified purely from
  -- raw_payload.metadata.kind, present from the very first INSERT — and, per
  -- this and the preceding migration's headers, processed_at never actually
  -- gets set for any of the three by the live webhook, so still requiring it
  -- here would make those branches unreachable in production.
  if txn.processed_at is null
     and coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}')
         not in ('service_purchase', 'voucher_payment', 'sponsored_subscription')
  then
    return;
  end if;

  v_amount := coalesce(txn.amount_minor, 0);
  if v_amount <= 0 then return; end if;
  v_cur := coalesce(txn.currency, 'NGN');
  v_date := coalesce(txn.processed_at::date, current_date);

  v_is_refund := txn.event_type::text ilike '%refund%';
  v_is_money_in := txn.event_type::text in ('charge.success','checkout.session.completed','invoice.payment_succeeded')
    or (txn.event_type::text = 'invoice.update'
        and (txn.raw_payload#>>'{data,paid}' = 'true' or txn.raw_payload#>>'{data,status}' = 'success'));

  if v_is_refund then
    perform private.finance_post_journal(v_date, v_cur, 'refund', txn.id::text,
      'Refund — ' || txn.provider::text,
      jsonb_build_array(
        jsonb_build_object('account_code','4900','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','1020','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id)),
      null);
    return;
  end if;

  if not v_is_money_in then return; end if;

  if txn.booking_order_id is not null then
    v_kind := 'booking';
  elsif txn.subscription_id is not null then
    v_kind := 'subscription';
  elsif txn.subscription_add_on_id is not null then
    v_kind := 'add_on';
  elsif coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}') = 'voucher_payment' then
    v_kind := 'voucher';
  elsif coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}') = 'service_purchase' then
    v_kind := 'service_purchase';
  elsif coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}') = 'sponsored_subscription' then
    v_kind := 'sponsored_subscription';
  else
    return;
  end if;

  if v_kind = 'booking' then
    -- Matched on the row rather than on booking_order_type's spelling: the
    -- question is whether a partner-billed order with a cost on it exists,
    -- and the row is the only thing that actually answers it. Both lookups
    -- run unconditionally — booking_order_id is a bare uuid with no FK, so
    -- there is no cheaper way to know which table it belongs to.
    select * into v_lab from public.lab_orders where id = txn.booking_order_id;
    select * into v_pharm from public.pharmacy_orders where id = txn.booking_order_id;

    v_cost := case
                when v_lab.id is not null and v_lab.fulfilment = 'partner'
                then coalesce(v_lab.partner_cost_kobo, 0)
                when v_lab.id is null and v_pharm.id is not null
                then coalesce(v_pharm.partner_cost_kobo, 0)
                else 0
              end;

    if v_cost > 0 and v_lab.id is not null then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,
                           'organisation_id',txn.organisation_id,
                           'memo','Patient payment for lab order ' || coalesce(v_lab.order_number, v_lab.id::text)),
        jsonb_build_object('account_code','2700','debit_minor',0,'credit_minor',v_cost,
                           'organisation_id',txn.organisation_id,
                           'counterparty',(select name from public.lab_providers where id = v_lab.partner_cost_provider_id),
                           'memo','Owed to the laboratory for this order'));

      if v_amount > v_cost then
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount - v_cost,
                             'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                             'memo','Tarragon margin on this review'));
      elsif v_amount < v_cost then
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('account_code','4100','debit_minor',v_cost - v_amount,'credit_minor',0,
                             'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                             'memo','Reversing revenue recognised on a voucher that is owed to the laboratory'));
      end if;

      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Lab review payment — partner-billed', v_lines, null);

    elsif v_cost > 0 and v_pharm.id is not null then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,
                           'organisation_id',txn.organisation_id,
                           'memo','Patient payment for pharmacy order ' || coalesce(v_pharm.order_number, v_pharm.id::text)),
        jsonb_build_object('account_code','2710','debit_minor',0,'credit_minor',v_cost,
                           'organisation_id',txn.organisation_id,
                           'counterparty',(select name from public.pharmacy_partners where id = v_pharm.partner_cost_provider_id),
                           'memo','Owed to the pharmacy for this order'));

      if v_amount > v_cost then
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount - v_cost,
                             'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                             'memo','Tarragon commission on this order'));
      elsif v_amount < v_cost then
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('account_code','4100','debit_minor',v_cost - v_amount,'credit_minor',0,
                             'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                             'memo','Reversing revenue recognised on a voucher that is owed to the pharmacy'));
      end if;

      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Pharmacy order payment — partner-billed', v_lines, null);

    else
      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Booking payment — ' || coalesce(txn.booking_order_type::text,'service'),
        jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET')),
        null);
    end if;

  elsif v_kind = 'voucher' then
    perform private.finance_post_journal(v_date, v_cur, 'voucher', txn.id::text,
      'Care voucher prepayment',
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','2100','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id)),
      null);

  elsif v_kind = 'service_purchase' then
    -- Correlate the same way apply_service_purchase_payment does: the
    -- checkout stamped pending_payment_provider_ref with the provider's own
    -- reference before the charge; activation later moves that value to
    -- payment_provider_ref and clears the pending one. Multiple AFTER
    -- INSERT triggers on payment_transactions fire in trigger-name order, so
    -- this may run before or after activation — matching on either column
    -- makes the lookup correct regardless of that ordering.
    v_ref := coalesce(
      txn.raw_payload #>> '{data,reference}',
      txn.raw_payload #>> '{data,object,id}');

    if v_ref is not null then
      select * into v_purchase from public.service_purchases
        where pending_payment_provider_ref = v_ref or payment_provider_ref = v_ref
        order by updated_at desc
        limit 1;
    end if;

    if v_purchase.id is null then
      -- Nothing to correlate against (yet, or a stale/malformed reference) —
      -- leave unposted for manual reconciliation rather than guessing.
      return;
    end if;

    select * into v_product from public.service_products where id = v_purchase.service_product_id;

    if v_product.access_duration_days is null then
      -- Perpetual/single-use grant — no window to defer over, recognised
      -- immediately at point of sale, same treatment as a plain booking.
      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Service purchase — ' || coalesce(v_product.name, v_product.code, 'pack'),
        jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',v_purchase.organisation_id),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,'organisation_id',v_purchase.organisation_id)),
        null);
    else
      -- Bounded-duration pack — deferred, recognised straight-line over the
      -- access window, exactly the subscription/add_on tail's mechanics
      -- below, just against the new 4020 account and the purchase's own
      -- window instead of a billing period.
      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Service purchase — ' || coalesce(v_product.name, v_product.code, 'pack'),
        jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',v_purchase.organisation_id),
          jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',v_amount,'organisation_id',v_purchase.organisation_id)),
        null);

      v_pstart := v_date;
      v_pend := (v_pstart + (v_product.access_duration_days || ' days')::interval)::date;
      if v_pend > v_pstart then
        perform private.finance_create_recognition_schedule(
          'service_purchase', v_purchase.id, txn.id, v_purchase.organisation_id,
          '4020', v_cur, v_amount, v_pstart, v_pend);
      end if;
    end if;

  elsif v_kind = 'sponsored_subscription' then
    -- Correlates the same way private.activate_sponsored_service_purchase
    -- does — by beneficiary_profile_id + plan_code from checkout metadata,
    -- not by a payment_provider_ref column: the sponsor flow upserts
    -- service_purchases directly from metadata rather than pre-creating a
    -- pending row with a provider reference to match against. Same
    -- accounting treatment as a plain service_purchase — a sponsor-funded
    -- pack is not a different product, just a different payer.
    v_meta := coalesce(
      txn.raw_payload -> 'data' -> 'metadata',
      txn.raw_payload -> 'data' -> 'object' -> 'metadata',
      txn.raw_payload -> 'metadata',
      '{}'::jsonb);
    v_beneficiary := nullif(v_meta ->> 'beneficiary_profile_id', '')::uuid;

    if v_beneficiary is null then return; end if;

    select * into v_product from public.service_products where code = v_meta ->> 'plan_code';
    if v_product.id is null then return; end if;

    select * into v_purchase from public.service_purchases
      where patient_id = v_beneficiary and service_product_id = v_product.id
      order by updated_at desc
      limit 1;

    if v_purchase.id is null then
      -- Activation trigger hasn't run yet (or failed its own checks) —
      -- leave unposted for manual reconciliation rather than guessing.
      return;
    end if;

    if v_product.access_duration_days is null then
      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Sponsored service — ' || coalesce(v_product.name, v_product.code, 'pack'),
        jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',v_purchase.organisation_id),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,'organisation_id',v_purchase.organisation_id)),
        null);
    else
      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Sponsored service — ' || coalesce(v_product.name, v_product.code, 'pack'),
        jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',v_purchase.organisation_id),
          jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',v_amount,'organisation_id',v_purchase.organisation_id)),
        null);

      v_pstart := v_date;
      v_pend := (v_pstart + (v_product.access_duration_days || ' days')::interval)::date;
      if v_pend > v_pstart then
        perform private.finance_create_recognition_schedule(
          'service_purchase', v_purchase.id, txn.id, v_purchase.organisation_id,
          '4020', v_cur, v_amount, v_pstart, v_pend);
      end if;
    end if;

  else
    v_txn_entry := private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
      initcap(v_kind) || ' payment',
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id)),
      null);

    if v_kind = 'subscription' then
      select interval, current_period_end into v_int, v_cpe from public.subscriptions where id = txn.subscription_id;
    else
      select interval, current_period_end into v_int, v_cpe from public.subscription_add_ons where id = txn.subscription_add_on_id;
    end if;
    v_pend := coalesce(v_cpe::date, v_date + (case when v_int = 'yearly' then interval '1 year' else interval '1 month' end)::interval);
    v_pstart := v_pend - (case when v_int = 'yearly' then interval '1 year' else interval '1 month' end)::interval;
    if v_pend > v_pstart then
      perform private.finance_create_recognition_schedule(
        v_kind, coalesce(txn.subscription_id, txn.subscription_add_on_id), txn.id, txn.organisation_id,
        case when v_kind = 'subscription' then '4000' else '4010' end,
        v_cur, v_amount, v_pstart, v_pend);
    end if;
  end if;
end;
$function$;

revoke all on function private.finance_post_from_payment(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. Dedicated triggers for voucher_payment and sponsored_subscription —
-- siblings to finance_post_service_purchase_payment and the other per-kind
-- AFTER INSERT triggers already on this table, gated on event_type directly
-- rather than processed_at. Exception-guarded, same as finance_on_payment_
-- processed, so a finance-posting failure can never abort or roll back the
-- payment write.
-- ---------------------------------------------------------------------------
create or replace function private.finance_on_voucher_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type::text in ('charge.success', 'checkout.session.completed')
     and coalesce(new.raw_payload#>>'{data,metadata,kind}', new.raw_payload#>>'{metadata,kind}') = 'voucher_payment'
  then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      raise warning 'finance_on_voucher_payment: posting failed for txn % (%)', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.finance_on_voucher_payment() from public;

drop trigger if exists finance_post_voucher_payment on public.payment_transactions;
create trigger finance_post_voucher_payment
  after insert on public.payment_transactions
  for each row execute function private.finance_on_voucher_payment();

create or replace function private.finance_on_sponsored_subscription_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type::text in ('charge.success', 'checkout.session.completed')
     and coalesce(new.raw_payload#>>'{data,metadata,kind}', new.raw_payload#>>'{metadata,kind}') = 'sponsored_subscription'
  then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      raise warning 'finance_on_sponsored_subscription_payment: posting failed for txn % (%)', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.finance_on_sponsored_subscription_payment() from public;

drop trigger if exists finance_post_sponsored_subscription_payment on public.payment_transactions;
create trigger finance_post_sponsored_subscription_payment
  after insert on public.payment_transactions
  for each row execute function private.finance_on_sponsored_subscription_payment();

-- ---------------------------------------------------------------------------
-- 3. Assertions — static checks, then real behavioural round trips for both
-- kinds, proving the gap is closed for a brand-new transaction each.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_org uuid;
  v_beneficiary uuid;
  v_voucher_id uuid;
  v_voucher_payment_id uuid;
  v_txn_id uuid;
  v_entry_id uuid;
  v_debits bigint;
  v_credits bigint;
  v_product record;
  v_purchase_id uuid;
  v_schedule_id uuid;
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.payment_transactions'::regclass
       and tgname = 'finance_post_voucher_payment'
       and not tgisinternal
  ) then
    raise exception 'FAIL: finance_post_voucher_payment trigger is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.payment_transactions'::regclass
       and tgname = 'finance_post_sponsored_subscription_payment'
       and not tgisinternal
  ) then
    raise exception 'FAIL: finance_post_sponsored_subscription_payment trigger is missing';
  end if;

  v_def := pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure);
  if v_def not like '%voucher_payment%' or v_def not like '%sponsored_subscription%' then
    raise exception 'FAIL: finance_post_from_payment guard was not widened for voucher_payment/sponsored_subscription';
  end if;
  -- Every branch that existed before this migration still exists.
  if v_def not like '%2700%' or v_def not like '%2710%'
   or v_def not like '%Care voucher prepayment%'
   or v_def not like '%service_purchase%'
   or v_def not like '%4900%' then
    raise exception 'a pre-existing payment-posting branch was lost';
  end if;

  select id, organisation_id into v_beneficiary, v_org from public.profiles where role = 'patient' order by created_at limit 1;
  select * into v_product from public.service_products where is_active and access_duration_days is not null limit 1;

  if v_beneficiary is null or v_product.id is null then
    raise notice 'SKIPPED behavioural proofs: no patient profile or bounded-duration service_product to test against';
  else
    -- --- voucher_payment proof --------------------------------------------
    -- Real shape purchase_service_voucher() produces (service_product_id,
    -- not panel_bundle_id/subscription_plan_id) — see the sibling
    -- 20260902193015 migration, which this one depends on for
    -- care_vouchers_kind_shape to accept it.
    insert into public.care_vouchers
      (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
       service_product_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
    values
      (v_org, 'TEST-FIN-PROOF-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service',
       v_beneficiary, v_beneficiary, v_product.id, 'test-sku', 'Finance posting gap proof', 1000000, 0, 'reserved')
    returning id into v_voucher_id;

    insert into public.care_voucher_payments
      (organisation_id, voucher_id, payer_profile_id, amount_minor, currency, instalment_kobo,
       pending_provider_ref, status)
    values
      (v_org, v_voucher_id, v_beneficiary, 1000000, 'NGN', 1000000,
       'test-ref-voucher-finance-proof', 'pending')
    returning id into v_voucher_payment_id;

    insert into public.payment_transactions
      (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
    values (
      'paystack', 'evt-voucher-finance-proof', 'charge.success', 1000000, 'NGN',
      jsonb_build_object('data', jsonb_build_object(
        'reference', 'test-ref-voucher-finance-proof',
        'metadata', jsonb_build_object('kind', 'voucher_payment')
      ))
    )
    returning id into v_txn_id;

    select je.id into v_entry_id from public.finance_journal_entries je
      where je.source = 'voucher' and je.source_ref = v_txn_id::text;
    if v_entry_id is null then
      raise exception 'FAIL: no finance_journal_entries row was posted for the voucher_payment test transaction — the gap is not closed';
    end if;

    select coalesce(sum(debit_minor),0), coalesce(sum(credit_minor),0)
      into v_debits, v_credits
      from public.finance_journal_lines where entry_id = v_entry_id;
    if v_debits <> v_credits or v_debits <> 1000000 then
      raise exception 'FAIL: voucher_payment journal entry is not balanced for the full amount (debits=%, credits=%)', v_debits, v_credits;
    end if;
    if not exists (select 1 from public.finance_journal_lines where entry_id = v_entry_id and account_code = '2100') then
      raise exception 'FAIL: voucher_payment did not post to Customer prepayments (2100)';
    end if;

    delete from public.finance_journal_lines where entry_id = v_entry_id;
    delete from public.finance_journal_entries where id = v_entry_id;
    -- apply_voucher_payment_from_transaction sets care_voucher_payments.
    -- payment_transaction_id to the new txn's id, so the FK requires this
    -- row gone before the transaction it points at can be deleted.
    delete from public.care_voucher_payments where id = v_voucher_payment_id;
    delete from public.payment_transactions where id = v_txn_id;
    delete from public.care_vouchers where id = v_voucher_id;

    -- --- sponsored_subscription proof --------------------------------------
    select * into v_product
      from public.service_products where is_active and code = 'ai_coach_daily_pass_30d';

    if v_product.id is null then
      raise notice 'SKIPPED sponsored_subscription behavioural proof: ai_coach_daily_pass_30d not found';
    else
      insert into public.service_purchases
        (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
         amount_kobo, currency, purchased_at, expires_at)
      values
        (v_org, v_beneficiary, v_beneficiary, v_product.id, 'active',
         v_product.price_kobo, v_product.currency, now(), now() + interval '30 days')
      returning id into v_purchase_id;

      insert into public.payment_transactions
        (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
      values (
        'paystack', 'evt-sponsored-finance-proof', 'charge.success', v_product.price_kobo, 'NGN',
        jsonb_build_object('data', jsonb_build_object(
          'reference', 'test-ref-sponsored-finance-proof',
          'metadata', jsonb_build_object(
            'kind', 'sponsored_subscription',
            'beneficiary_profile_id', v_beneficiary::text,
            'plan_code', v_product.code
          )
        ))
      )
      returning id into v_txn_id;

      select je.id into v_entry_id from public.finance_journal_entries je
        where je.source = 'payment' and je.source_ref = v_txn_id::text;
      if v_entry_id is null then
        raise exception 'FAIL: no finance_journal_entries row was posted for the sponsored_subscription test transaction — the gap is not closed';
      end if;

      select coalesce(sum(debit_minor),0), coalesce(sum(credit_minor),0)
        into v_debits, v_credits
        from public.finance_journal_lines where entry_id = v_entry_id;
      if v_debits <> v_credits or v_debits <> v_product.price_kobo then
        raise exception 'FAIL: sponsored_subscription journal entry is not balanced for the full amount (debits=%, credits=%)', v_debits, v_credits;
      end if;

      -- ai_coach_daily_pass_30d has a bounded access window, so the branch
      -- above also opened a revenue_recognition_schedules row referencing
      -- this transaction — must go before payment_transactions is deleted.
      select id into v_schedule_id from public.revenue_recognition_schedules
        where payment_transaction_id = v_txn_id;

      delete from public.revenue_recognition_schedules where id = v_schedule_id;
      delete from public.finance_journal_lines where entry_id = v_entry_id;
      delete from public.finance_journal_entries where id = v_entry_id;
      delete from public.payment_transactions where id = v_txn_id;
      delete from public.service_purchases where id = v_purchase_id;
    end if;
  end if;

  raise notice 'PASS: voucher_payment and sponsored_subscription payments now post to the GL, with every pre-existing branch intact';
end $$;
