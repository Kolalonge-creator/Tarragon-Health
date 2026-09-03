-- Tarragon Health — reconcile PR #401 (§91 Payments/Billing gap closure)
-- against the 2026-08-31 pay-per-service cutover.
--
-- private.resolve_payment_payer() and private.payment_transaction_service_
-- label() (20260830101217_finance_unified_ledger.sql, §91.12) predate the
-- cutover (20260831140512_service_products_and_purchases_core.sql onward)
-- by one day and were never revisited when it landed — they still only know
-- how to attribute a payment_transactions row via subscriptions/
-- subscription_add_ons/care_voucher_payments/booking_order_type, with no
-- branch for a service_purchase payment at all.
--
-- This is the exact same class of gap just fixed in
-- 20260902103712_fix_service_purchase_finance_posting_gap.sql for GL
-- posting: a service_purchase payment_transactions row is real and
-- correctly posted to the ledger by that migration (finance_journal_entries
-- with source_ref = the transaction id), so it already surfaces as a row in
-- finance_unified_ledger()'s `rows` CTE (which joins on source_ref) — but
-- with payer_profile_id resolving to null (no branch here recognises it),
-- which means:
--   1. finance_unified_ledger(p_profile_id => ...) — the query
--      apps/web/.../patient/financial-profile/page.tsx runs for "your
--      transaction history" — filters `where r.payer_profile_id =
--      p_profile_id`, so a patient's own service-pack purchases silently
--      never appear in their own history.
--   2. payments_with_payer_for_fraud_sweep() (20260830110013) calls
--      resolve_payment_payer directly, so fraud-sweep.ts's velocity/
--      duplicate/unusual-amount heuristics silently never see a
--      service_purchase payment either.
--   3. service_label falls through to the generic 'Payment' default instead
--      of a real label, for finance staff viewing the org-wide ledger too.
--
-- Fix, mirroring the finance-posting-gap migration's own correlation
-- approach exactly: service_purchases has no direct FK to
-- payment_transactions (unlike care_voucher_payments), so it is matched the
-- same way private.apply_service_purchase_payment and the finance-posting
-- migration's own service_purchase branch already do — via
-- pending_payment_provider_ref / payment_provider_ref against the
-- provider's own reference embedded in raw_payload — gated on
-- metadata.kind = 'service_purchase' so this can never accidentally match
-- an unrelated transaction that happens to share a reference string.
--
-- Live-verified before writing this: 0 payment_fraud_signals /
-- finance_unified_ledger rows are affected (pre-revenue, no real
-- service_purchases payment has ever landed), so there is nothing to
-- backfill — this only changes resolution for transactions from this point
-- forward.

create or replace function private.resolve_payment_payer(p_txn public.payment_transactions)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select subscriber_id from public.subscriptions where id = p_txn.subscription_id),
    (select s.subscriber_id from public.subscription_add_ons a
       join public.subscriptions s on s.id = a.subscription_id
      where a.id = p_txn.subscription_add_on_id),
    (select payer_profile_id from public.care_voucher_payments
      where payment_transaction_id = p_txn.id limit 1),
    (
      select sp.patient_id
      from public.service_purchases sp
      where coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'service_purchase'
        and (
          sp.pending_payment_provider_ref = coalesce(p_txn.raw_payload #>> '{data,reference}', p_txn.raw_payload #>> '{data,object,id}')
          or sp.payment_provider_ref = coalesce(p_txn.raw_payload #>> '{data,reference}', p_txn.raw_payload #>> '{data,object,id}')
        )
      order by sp.updated_at desc
      limit 1
    ),
    case p_txn.booking_order_type::text
      when 'lab' then (select patient_id from public.lab_orders where id = p_txn.booking_order_id)
      when 'pharmacy' then (select patient_id from public.pharmacy_orders where id = p_txn.booking_order_id)
      when 'referral' then (select patient_id from public.specialist_referrals where id = p_txn.booking_order_id)
      else null
    end
  );
$$;

revoke all on function private.resolve_payment_payer(public.payment_transactions) from public, anon;

create or replace function private.payment_transaction_service_label(p_txn public.payment_transactions)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_txn.id is null then null
    when p_txn.booking_order_type is not null then initcap(p_txn.booking_order_type::text) || ' order'
    when p_txn.subscription_id is not null then 'Subscription'
    when p_txn.subscription_add_on_id is not null then 'Add-on'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'voucher_payment'
      then 'Care voucher payment'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'sponsored_subscription'
      then 'Sponsored subscription'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'service_purchase'
      then 'Service purchase'
    else 'Payment'
  end;
$$;

revoke all on function private.payment_transaction_service_label(public.payment_transactions) from public, anon;

-- ---------------------------------------------------------------------------
-- Assertions — static (every pre-existing branch survives, anon still
-- locked out) then a real behavioural round trip proving a service_purchase
-- transaction now resolves to its actual patient, not null.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_product record;
  v_patient uuid;
  v_purchase_id uuid;
  v_txn public.payment_transactions%rowtype;
  v_resolved uuid;
  v_label text;
begin
  v_def := pg_get_functiondef('private.resolve_payment_payer(public.payment_transactions)'::regprocedure);
  if v_def not like '%service_purchases%' then
    raise exception 'FAIL: resolve_payment_payer does not know about service_purchases';
  end if;
  if v_def not like '%subscriptions%' or v_def not like '%subscription_add_ons%'
   or v_def not like '%care_voucher_payments%' or v_def not like '%booking_order_type%' then
    raise exception 'FAIL: a pre-existing resolve_payment_payer branch was lost';
  end if;

  v_def := pg_get_functiondef('private.payment_transaction_service_label(public.payment_transactions)'::regprocedure);
  if v_def not like '%service_purchase%' then
    raise exception 'FAIL: payment_transaction_service_label does not know about service_purchase';
  end if;
  if v_def not like '%Subscription%' or v_def not like '%Sponsored subscription%'
   or v_def not like '%Care voucher payment%' then
    raise exception 'FAIL: a pre-existing payment_transaction_service_label branch was lost';
  end if;

  if has_function_privilege('anon', 'private.resolve_payment_payer(public.payment_transactions)', 'EXECUTE')
     or has_function_privilege('anon', 'private.payment_transaction_service_label(public.payment_transactions)', 'EXECUTE') then
    raise exception 'FAIL: anon must never execute either helper';
  end if;

  select id, access_duration_days into v_product from public.service_products where code = 'essential_pack';
  select id into v_patient from public.profiles where role = 'patient' limit 1;

  if v_patient is null or v_product.id is null then
    raise notice 'SKIPPED behavioural proof: no patient row or essential_pack product to test against';
  else
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, pending_payment_provider_ref)
    select p.organisation_id, v_patient, v_patient, v_product.id, 'pending_payment',
           1000000, 'NGN', 'test-ref-resolve-payment-payer-proof'
    from public.profiles p where p.id = v_patient
    returning id into v_purchase_id;

    insert into public.payment_transactions
      (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
    values (
      'paystack', 'evt-resolve-payment-payer-proof', 'charge.success', 1000000, 'NGN',
      jsonb_build_object('data', jsonb_build_object(
        'reference', 'test-ref-resolve-payment-payer-proof',
        'metadata', jsonb_build_object('kind', 'service_purchase')
      ))
    )
    returning * into v_txn;

    v_resolved := private.resolve_payment_payer(v_txn);
    if v_resolved is distinct from v_patient then
      raise exception 'FAIL: resolve_payment_payer did not attribute the service_purchase payment to its patient (got %, expected %)', v_resolved, v_patient;
    end if;

    v_label := private.payment_transaction_service_label(v_txn);
    if v_label is distinct from 'Service purchase' then
      raise exception 'FAIL: payment_transaction_service_label returned % instead of ''Service purchase''', v_label;
    end if;

    delete from public.payment_transactions where id = v_txn.id;
    delete from public.service_purchases where id = v_purchase_id;
  end if;

  raise notice 'PASS: resolve_payment_payer/payment_transaction_service_label now recognise service_purchase transactions, every pre-existing branch intact, anon still locked out';
end $$;
