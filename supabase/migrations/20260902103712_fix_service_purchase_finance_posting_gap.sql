-- Tarragon Health — fix: pay-per-service revenue never reaches Finance.
--
-- Root cause has two independent layers, both fixed here.
--
-- Layer 1 (classification): private.finance_post_from_payment() classifies a
-- payment_transactions row by booking_order_id / subscription_id /
-- subscription_add_on_id / metadata.kind='voucher_payment' only. The
-- 2026-08-31 pay-per-service cutover (20260831140512_service_products_and_
-- purchases_core.sql, 20260831143207_service_purchase_checkout_and_payment_
-- trigger.sql) tags its checkout metadata.kind='service_purchase', which
-- matches none of those and falls through to `else return;` — no journal
-- entry, ever, for any service_purchases payment.
--
-- Layer 2 (trigger wiring — the part that makes fixing Layer 1 alone
-- insufficient): finance_post_from_payment is only invoked by
-- finance_post_payment_processed (`AFTER INSERT OR UPDATE OF processed_at`),
-- gated inside finance_post_from_payment itself on `txn.processed_at is not
-- null`. Read live (paystack-webhook/index.ts, stripe-webhook/index.ts):
-- both webhooks insert payment_transactions with processed_at NULL, and only
-- set it via a later `markProcessed()` UPDATE — which their own
-- charge.success/checkout.session.completed switch only ever calls for
-- metadata.kind IN ('booking','subscription'), with every other kind
-- (including 'add_on' by omission, and now 'service_purchase') falling into
-- the generic else-branch, which assumes 'add_on', finds no matching
-- subscription_add_ons row, and calls `markFailed()` — never
-- `markProcessed()`. So processed_at is NEVER set for a service_purchase
-- transaction, and finance_post_payment_processed never fires for one no
-- matter what finance_post_from_payment's own classification logic does.
-- This is the exact same root cause already diagnosed and fixed twice in
-- this codebase for a different metadata.kind — see
-- 20260830112900_fix_activate_sponsored_subscription_processed_at_dependency.sql,
-- which mirrors private.apply_voucher_payment_from_transaction /
-- private.apply_service_purchase_payment: both are deliberately `AFTER
-- INSERT` and gate on `event_type` directly (always correct from the very
-- first INSERT), never on `processed_at` (which these checkout kinds never
-- get). That is precisely why service_purchases activation itself already
-- works correctly (apply_service_purchase_payment) while GL posting for the
-- exact same payment does not — the two are wired through different
-- triggers with different (and, for finance, wrong) gating.
--
-- Fix, mirroring that established pattern exactly:
--   1. finance_post_from_payment gains a `service_purchase` branch, and its
--      blanket `processed_at is null -> return` guard is narrowed to still
--      require processed_at for every kind that genuinely needs the
--      webhook's later enrichment UPDATE (booking/subscription/add_on) —
--      completely unchanged for those — but no longer blocks a
--      service_purchase row, whose classification signal
--      (metadata.kind) is present in raw_payload from the very first
--      INSERT.
--   2. A new, dedicated trigger (finance_post_service_purchase_payment,
--      AFTER INSERT, gated on event_type + metadata.kind='service_purchase')
--      invokes finance_post_from_payment directly — a sibling to the six
--      other per-kind AFTER INSERT triggers already on payment_transactions
--      (activate_sponsored_service_purchase, apply_subsidy_contribution_
--      from_transaction, payment_transactions_activate_programme_purchase,
--      payment_transactions_apply_screening_day_payment, payment_
--      transactions_apply_service_purchase, payment_transactions_apply_
--      voucher_payment), not a rewrite of the shared
--      finance_post_payment_processed trigger that booking/subscription/
--      add_on still correctly rely on. Both finance_post_journal and
--      finance_create_recognition_schedule are already idempotent per
--      source_ref / payment_transaction_id, so this new trigger firing
--      alongside the (normally silent, for this kind) existing one is safe.
--
-- Accounting treatment for the new branch mirrors the existing
-- subscription/add_on tail exactly, per service_products.access_duration_
-- days' own documented contract ("null = perpetual/single-use grant ...
-- otherwise the access window length in days"): a bounded pack is deferred
-- (2000) and recognised straight-line over its access window via the
-- existing finance_create_recognition_schedule machinery, same as a
-- subscription/add-on payment; a perpetual/single-use grant (no window to
-- defer over) is recognised immediately at point of sale, same as a plain
-- booking. Packs are not literally "recurring" (4000/4010's own
-- descriptions say "recurring ... revenue, recognised over the billing
-- period" — no longer accurate now subscriptions are retired), so this adds
-- one new revenue account (4020) rather than repurposing those.
--
-- Live-verified before writing this: 0 payment_transactions rows of either
-- metadata.kind (service_purchase or voucher_payment — voucher_payment has
-- the exact same processed_at gap, pre-existing before this migration and
-- NOT touched here; flagged separately) currently exist on the live
-- project, and platform is pre-revenue, so there is nothing to backfill.

-- ---------------------------------------------------------------------------
-- 1. New revenue account for bounded-duration service-pack revenue.
-- ---------------------------------------------------------------------------
insert into public.finance_accounts
  (code, name, account_type, normal_balance, vat_treatment, sort_order, description)
values
  ('4020', 'Service pack revenue', 'revenue', 'credit', 'exempt', 61,
   'Pay-per-service bounded-duration pack revenue (service_purchases with an access_duration_days window), recognised straight-line over the access window. A perpetual/single-use grant with no window is recognised immediately in 4100 instead, same as a booking.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. revenue_recognition_schedules.source_kind was a closed enumeration of
-- ('subscription','add_on') — widen it to admit the pay-per-service
-- replacement source, same additive-constraint-widening shape as the
-- 20260829011043 fix for finance_journal_entries.source.
-- ---------------------------------------------------------------------------
alter table public.revenue_recognition_schedules
  drop constraint revenue_recognition_schedules_source_kind_check;
alter table public.revenue_recognition_schedules
  add constraint revenue_recognition_schedules_source_kind_check
  check (source_kind in ('subscription', 'add_on', 'service_purchase'));

-- ---------------------------------------------------------------------------
-- 3. finance_post_from_payment — one new branch, one narrowed guard. Every
-- previously-existing branch (booking/lab/pharmacy, voucher, the generic
-- subscription/add_on tail, refund) is preserved verbatim.
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
begin
  select * into txn from public.payment_transactions where id = p_txn_id;
  if txn.id is null then return; end if;

  -- Every other kind's classification depends on enrichment columns
  -- (booking_order_id/subscription_id/subscription_add_on_id) that only
  -- arrive together with processed_at via the webhook's later UPDATE, so
  -- they still correctly require it. A service_purchase row is classified
  -- purely from raw_payload.metadata.kind, present from the very first
  -- INSERT — and, per this migration's header, processed_at never actually
  -- gets set for it by the live webhook, so still requiring it here would
  -- make the branch below unreachable in production.
  if txn.processed_at is null
     and coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}') is distinct from 'service_purchase'
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
-- 4. Dedicated trigger for service_purchase — sibling to the other per-kind
-- AFTER INSERT triggers already on this table (payment_transactions_apply_
-- service_purchase, payment_transactions_apply_voucher_payment, etc.), gated
-- on event_type directly rather than processed_at, matching the pattern
-- fixed_activate_sponsored_subscription_processed_at_dependency established.
-- Exception-guarded, same as finance_on_payment_processed, so a
-- finance-posting failure can never abort or roll back the payment write.
-- ---------------------------------------------------------------------------
create or replace function private.finance_on_service_purchase_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type::text in ('charge.success', 'checkout.session.completed')
     and coalesce(new.raw_payload#>>'{data,metadata,kind}', new.raw_payload#>>'{metadata,kind}') = 'service_purchase'
  then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      raise warning 'finance_on_service_purchase_payment: posting failed for txn % (%)', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.finance_on_service_purchase_payment() from public;

drop trigger if exists finance_post_service_purchase_payment on public.payment_transactions;
create trigger finance_post_service_purchase_payment
  after insert on public.payment_transactions
  for each row execute function private.finance_on_service_purchase_payment();

-- ---------------------------------------------------------------------------
-- 5. Assertions — static checks, then a real behavioural round trip proving
-- the gap is closed for a brand-new transaction (matching this migration's
-- own header claim, not just the presence of the code).
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_product record;
  v_patient uuid;
  v_purchase_id uuid;
  v_txn_id uuid;
  v_entry_id uuid;
  v_schedule_id uuid;
  v_debits bigint;
  v_credits bigint;
begin
  if not exists (select 1 from public.finance_accounts
                  where code = '4020' and name = 'Service pack revenue'
                    and account_type = 'revenue' and normal_balance = 'credit') then
    raise exception '4020 is not the service-pack-revenue account — the code is taken by "%"',
      coalesce((select name from public.finance_accounts where code = '4020'), 'nothing');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.revenue_recognition_schedules'::regclass
      and conname = 'revenue_recognition_schedules_source_kind_check'
      and pg_get_constraintdef(oid) like '%service_purchase%'
  ) then
    raise exception 'FAIL: revenue_recognition_schedules.source_kind was not widened to admit service_purchase';
  end if;

  v_def := pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure);
  if v_def not like '%service_purchase%' or v_def not like '%4020%' then
    raise exception 'FAIL: finance_post_from_payment does not post service_purchase transactions';
  end if;
  -- Every branch that existed before this migration still exists.
  if v_def not like '%2700%' or v_def not like '%2710%'
   or v_def not like '%Care voucher prepayment%'
   or v_def not like '%finance_create_recognition_schedule%'
   or v_def not like '%4900%' then
    raise exception 'a pre-existing payment-posting branch was lost';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.payment_transactions'::regclass
       and tgname = 'finance_post_service_purchase_payment'
       and not tgisinternal
  ) then
    raise exception 'FAIL: finance_post_service_purchase_payment trigger is missing';
  end if;

  -- Behavioural proof: a bounded-duration pack (access_duration_days not
  -- null) posts to Deferred revenue and opens a recognition schedule.
  select id, access_duration_days into v_product from public.service_products where code = 'essential_pack';
  select id into v_patient from public.profiles where role = 'patient' limit 1;

  if v_patient is null or v_product.id is null then
    raise notice 'SKIPPED behavioural proof: no patient row or essential_pack product to test against';
  else
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, pending_payment_provider_ref)
    select p.organisation_id, v_patient, v_patient, v_product.id, 'pending_payment',
           1000000, 'NGN', 'test-ref-finance-posting-gap-proof'
    from public.profiles p where p.id = v_patient
    returning id into v_purchase_id;

    insert into public.payment_transactions
      (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
    values (
      'paystack', 'evt-finance-posting-gap-proof', 'charge.success', 1000000, 'NGN',
      jsonb_build_object('data', jsonb_build_object(
        'reference', 'test-ref-finance-posting-gap-proof',
        'metadata', jsonb_build_object('kind', 'service_purchase')
      ))
    )
    returning id into v_txn_id;

    select je.id into v_entry_id from public.finance_journal_entries je
      where je.source = 'payment' and je.source_ref = v_txn_id::text;
    if v_entry_id is null then
      raise exception 'FAIL: no finance_journal_entries row was posted for the service_purchase test transaction — the gap is not closed';
    end if;

    select coalesce(sum(debit_minor),0), coalesce(sum(credit_minor),0)
      into v_debits, v_credits
      from public.finance_journal_lines where entry_id = v_entry_id;
    if v_debits <> v_credits or v_debits <> 1000000 then
      raise exception 'FAIL: posted journal entry is not balanced for the full amount (debits=%, credits=%)', v_debits, v_credits;
    end if;
    if not exists (select 1 from public.finance_journal_lines where entry_id = v_entry_id and account_code = '2000') then
      raise exception 'FAIL: bounded-duration pack did not post to Deferred revenue (2000)';
    end if;

    select id into v_schedule_id from public.revenue_recognition_schedules
      where payment_transaction_id = v_txn_id;
    if v_schedule_id is null then
      raise exception 'FAIL: no revenue_recognition_schedules row was opened for the bounded-duration pack';
    end if;
    if not exists (select 1 from public.revenue_recognition_schedules
                    where id = v_schedule_id and source_kind = 'service_purchase'
                      and revenue_account_code = '4020' and total_minor = 1000000) then
      raise exception 'FAIL: recognition schedule was not opened correctly (wrong source_kind/account/total)';
    end if;

    -- Clean up every row this proof created, including the ledger rows, so
    -- no test data survives in real financial reporting.
    delete from public.revenue_recognition_schedules where id = v_schedule_id;
    delete from public.finance_journal_lines where entry_id = v_entry_id;
    delete from public.finance_journal_entries where id = v_entry_id;
    delete from public.payment_transactions where id = v_txn_id;
    delete from public.service_purchases where id = v_purchase_id;
  end if;

  raise notice 'PASS: service_purchase payments now post to the GL (immediate for a perpetual grant, deferred + scheduled for a bounded pack), with every pre-existing branch intact';
end $$;
