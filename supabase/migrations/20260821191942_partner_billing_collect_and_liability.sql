-- Option A, part 1: take the patient's money, and be honest about whose it is.
--
-- Until now every booking payment posted its whole value to 4100 Booking &
-- service revenue. For a video visit that is correct — all of it is ours. For
-- a partner lab review it is not: most of that money is Synlab's, and we are
-- holding it until they invoice. Booking it as revenue would overstate income
-- by roughly five times on every lab order and leave the amount owed to the
-- partner nowhere on the balance sheet at all.
--
-- So a lab payment splits at the moment it lands:
--   Dr 1020 Payment processor clearing   the whole amount collected
--   Cr 2700 Partner lab funds payable    what Synlab charges us  (LIABILITY)
--   Cr 4100 Booking & service revenue    the remainder           (OURS)
--
-- WHY THE COST IS SNAPSHOTTED ON THE ORDER, NOT LOOKED UP AT PAYMENT TIME
-- ----------------------------------------------------------------------
-- lab_tests.price_kobo is a live contract price and will change — Synlab will
-- reprice, and the founder will renegotiate. If the split recomputed the cost
-- when the payment webhook fires, then a price change between booking and
-- payment (minutes, or days for a bank transfer) would silently move money
-- between a liability and revenue, and a reprice would retroactively change
-- what we believe we owe on orders already paid for. The amount owed to a
-- partner is fixed the moment the patient is charged, so it is written onto
-- the order then and never derived again.
--
-- PRINCIPAL VS AGENT — A REAL QUESTION FOR AN ACCOUNTANT, NOT A CODING ONE
-- -----------------------------------------------------------------------
-- This posts the "agent" treatment: only the margin is revenue, exactly as the
-- founder's own note asked ("money you're holding isn't yours ... tracked as a
-- liability, not counted as revenue"). Under IFRS 15 a case can also be made
-- that Tarragon is PRINCIPAL — it chooses the tests, contracts the lab, sets
-- the patient price and carries the risk — which would mean recognising the
-- gross amount as revenue and the lab's charge as cost of sales. The
-- difference does not change a single naira of cash or of what Synlab is owed;
-- it changes reported revenue by about 5x, which matters for any conversation
-- involving a bank, an investor or FIRS. Deliberately not decided here. If an
-- accountant says principal, the change is confined to the one branch below.

-- ---------------------------------------------------------------------------
-- 1. The liability account.
--
-- Modelled on 2100 Customer wallet funds, which already exists for exactly
-- this shape of problem: money sitting in Tarragon's bank account that belongs
-- to somebody else.
-- ---------------------------------------------------------------------------
-- 2700, not 2500. Dry-running this migration posted a live split into 2500 and
-- the ledger came back reading "Accounts payable — vendors": 2500 was already
-- taken by the accounts-payable migration, and `on conflict do nothing` had
-- silently accepted that and carried on posting partner money into someone
-- else's account. A code collision in a chart of accounts does not raise
-- anything — it just quietly files the money in the wrong place — so the
-- assertion below now checks the NAME, and a future collision fails loudly.
--
-- The two accounts are a chain rather than rivals, and the settlement
-- migration uses both: money is held in 2700 while it is merely owed to the
-- laboratory, moves to 2500 when a statement is agreed and becomes a formal
-- vendor payable, and leaves 2500 for the bank when the bill is paid.
insert into public.finance_accounts
  (code, name, account_type, normal_balance, vat_treatment, sort_order, description)
values
  ('2700', 'Partner lab funds payable', 'liability', 'credit', 'exempt', 46,
   'Collected from patients for laboratory tests and owed to the partner laboratory until a statement is agreed. Not revenue. Moves to 2500 Accounts payable when the statement is approved.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. What we owe, recorded on the order.
-- ---------------------------------------------------------------------------
alter table public.lab_orders
  add column if not exists partner_cost_kobo bigint,
  add column if not exists partner_cost_provider_id uuid references public.lab_providers (id) on delete restrict;

comment on column public.lab_orders.partner_cost_kobo is
  'What the partner laboratory charges Tarragon for the tests actually being delivered on this order, snapshotted when the order is created. This is the liability; total_kobo is what the patient pays; the difference is Tarragon''s margin. Never recomputed — a later contract reprice must not change what we believe we owe on an order already paid for.';
comment on column public.lab_orders.partner_cost_provider_id is
  'Which laboratory''s price list partner_cost_kobo came from, so a settlement statement can be matched back to the right contract even after the order has been routed or the patient has moved facility.';

alter table public.lab_orders
  drop constraint if exists lab_orders_partner_cost_only_for_partner_fulfilment;
alter table public.lab_orders
  add constraint lab_orders_partner_cost_only_for_partner_fulfilment check (
    (partner_cost_kobo is null and partner_cost_provider_id is null)
    or (fulfilment = 'partner' and partner_cost_kobo is not null
        and partner_cost_kobo >= 0 and partner_cost_provider_id is not null)
  );

-- ---------------------------------------------------------------------------
-- 3. Which laboratory is actually fulfilling this order.
--
-- Two columns can name one: provider_id directly, or facility_id whose
-- facility belongs to a provider. Both are legitimate routes (a clinician
-- routing to a provider, a patient picking a collection centre), so the cost
-- lookup resolves either rather than insisting on one and silently failing on
-- the other.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_lab_order_provider(
  p_provider_id uuid,
  p_facility_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select lp.id from public.lab_providers lp where lp.id = p_provider_id and lp.is_active),
    (select f.lab_provider_id from public.facilities f
      where f.id = p_facility_id and f.is_active and f.lab_provider_id is not null),
    -- Exactly one active laboratory is the unambiguous case, and it is the
    -- case Tarragon is in: one contracted partner. With two or more this
    -- returns null rather than guessing, and the order is refused with a
    -- message asking which one — silently picking a laboratory would mean
    -- silently picking a price list, and billing the patient against the
    -- wrong contract.
    (select lp.id from public.lab_providers lp
      where lp.is_active
        and (select count(*) from public.lab_providers x where x.is_active) = 1
      limit 1)
  );
$$;

revoke all on function private.resolve_lab_order_provider(uuid, uuid) from public;

create or replace function private.compute_partner_cost(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_bundle_id uuid,
  p_provider_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codes   text[];
  v_code    text;
  v_cost    bigint;
  v_total   bigint := 0;
  v_missing text[] := '{}';
begin
  select private.patient_delivered_test_codes(p_patient_id, p_organisation_id, pb.test_codes)
    into v_codes
    from public.panel_bundles pb where pb.id = p_bundle_id;

  if v_codes is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_bundle');
  end if;

  foreach v_code in array v_codes loop
    select lt.price_kobo into v_cost
      from public.lab_tests lt
     where lt.provider_id = p_provider_id and lt.code = v_code;

    -- A test the partner does not offer is not a rounding problem. Ordering it
    -- would take the patient's money for something the lab will not run.
    if v_cost is null then
      v_missing := v_missing || v_code;
    else
      v_total := v_total + v_cost;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', (array_length(v_missing, 1) is null),
    'cost_kobo', v_total,
    'missing_codes', to_jsonb(v_missing)
  );
end;
$$;

revoke all on function private.compute_partner_cost(uuid, uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 4. The order records both numbers at once.
--
-- Supersedes the version in the computed-price migration. Same pricing logic;
-- it now also resolves the fulfilling laboratory and snapshots what that
-- laboratory charges us, in the same statement that sets what the patient
-- pays. The two numbers cannot drift apart because they are written together
-- or not at all.
-- ---------------------------------------------------------------------------
create or replace function private.set_lab_order_computed_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price    jsonb;
  v_cost     jsonb;
  v_provider uuid;
begin
  if new.fulfilment is distinct from 'partner' or new.panel_bundle_id is null then
    return new;
  end if;

  v_price := private.compute_review_price(
    new.patient_id, new.organisation_id, new.panel_bundle_id
  );

  if not coalesce((v_price ->> 'ok')::boolean, false) then
    raise exception 'Cannot price this review: %', coalesce(v_price ->> 'error', 'unknown')
      using errcode = '23514';
  end if;

  if coalesce((v_price ->> 'delivered_count')::int, 0) = 0 then
    raise exception 'This review contains nothing for this patient — every test in % is excluded for them (sex, age, already on file, or an unmet gate). Ordering it would bill nothing and wait forever for a result.',
      v_price ->> 'bundle_code'
      using errcode = '23514';
  end if;

  if not coalesce((v_price ->> 'priceable')::boolean, false) then
    raise exception 'Cannot bill this review — no price on file for: %. Set screen_types.price_kobo before billing it.',
      (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(v_price -> 'unpriced_codes'))
      using errcode = '23514';
  end if;

  new.total_kobo := (v_price ->> 'total_kobo')::bigint;

  v_provider := private.resolve_lab_order_provider(new.provider_id, new.facility_id);
  if v_provider is null then
    raise exception 'No active partner laboratory for this order. A partner-fulfilled order must name the laboratory that will run it.'
      using errcode = '23514';
  end if;

  v_cost := private.compute_partner_cost(
    new.patient_id, new.organisation_id, new.panel_bundle_id, v_provider
  );

  if not coalesce((v_cost ->> 'ok')::boolean, false) then
    raise exception 'The partner laboratory has no contracted price for: %. Taking payment for a test they have not agreed to run would leave the patient paid up and the test undeliverable.',
      (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(v_cost -> 'missing_codes'))
      using errcode = '23514';
  end if;

  new.partner_cost_kobo        := (v_cost ->> 'cost_kobo')::bigint;
  new.partner_cost_provider_id := v_provider;

  return new;
end;
$$;

revoke all on function private.set_lab_order_computed_price() from public;

-- ---------------------------------------------------------------------------
-- 5. Never sell a review for less than the laboratory charges for it.
--
-- A live risk rather than a theoretical one. The screen-tier subscriber
-- discount is 15% (private.apply_screening_subscriber_discount) and Synlab's
-- contracted margin is 18-21% ON COST, which is only about 15-17% OF THE
-- PATIENT PRICE. A discounted review therefore clears its own cost by roughly
-- one to two percent, and anything further — a second discount, a promotion,
-- a renegotiated cost — takes it negative.
--
-- This is its own trigger, and its name is load-bearing. Postgres fires
-- same-timing triggers in alphabetical order, and the discount is applied by
-- lab_orders_screening_subscriber_discount. A check living inside the pricing
-- trigger (lab_orders_compute_review_price, 'c') would run BEFORE the discount
-- existed, pass against the undiscounted price, and be undercut moments later
-- by the very thing it was meant to catch. 'zz' puts it last, after every
-- trigger that can still move money on this row.
--
-- A voucher is deliberately not netted off: voucher money was collected
-- earlier and is still Tarragon's to apply, so only the subscriber discount is
-- a genuine giveaway.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_lab_order_not_below_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_net bigint;
begin
  if new.fulfilment is distinct from 'partner' or new.partner_cost_kobo is null then
    return new;
  end if;

  v_net := coalesce(new.total_kobo, 0) - coalesce(new.subscriber_discount_kobo, 0);

  if v_net < new.partner_cost_kobo then
    raise exception 'This review would be sold below cost: the patient pays % kobo after discount, and % charges % kobo to run it.',
      v_net,
      coalesce((select name from public.lab_providers where id = new.partner_cost_provider_id), 'the laboratory'),
      new.partner_cost_kobo
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_lab_order_not_below_cost() from public;

drop trigger if exists lab_orders_zz_never_below_partner_cost on public.lab_orders;
create trigger lab_orders_zz_never_below_partner_cost
  before insert on public.lab_orders
  for each row execute function private.enforce_lab_order_not_below_cost();

-- ---------------------------------------------------------------------------
-- 6. The payment splits.
--
-- Supersedes the live definition (pulled with pg_get_functiondef before
-- writing this, not read from the migration file — the two had already
-- diverged: the live copy carries a 'voucher' branch and a PARTNER_NET cost
-- centre that the committed file does not). Every branch is preserved; only
-- the booking branch changes, and only for a lab order that Tarragon is
-- actually billing.
--
-- WHY THE VOUCHER-COVERED PART NEEDS NO SPECIAL CASE
-- --------------------------------------------------
-- A care voucher is already recognised as revenue when it is redeemed
-- (private.finance_post_voucher_redeemed: Dr 2100, Cr 4100, full face value).
-- Under partner billing part of that is Synlab's, so it was over-recognised —
-- but this journal fixes it without ever mentioning the voucher, because it
-- posts the whole partner cost to the liability and lets 4100 take whatever
-- is left on whichever side it falls:
--
--   card amount A debits 1020, partner cost C credits 2700, and 4100 takes
--   A - C — a credit when the card covered more than the cost, a DEBIT when it
--   covered less, which is exactly the reversal of revenue the voucher
--   redemption recognised too early.
--
-- Both cases balance with no reference to the voucher at all, and the ledger
-- ends up correct whether the patient paid entirely by card, entirely from a
-- voucher, or with any mixture of the two.
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
  v_cost bigint;
  v_lines jsonb;
begin
  select * into txn from public.payment_transactions where id = p_txn_id;
  if txn.id is null then return; end if;
  if txn.processed_at is null then return; end if;
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
  else
    return;
  end if;

  if v_kind = 'booking' then
    -- Matched on the row rather than on booking_order_type's spelling: the
    -- question is whether a partner lab order with a cost on it exists, and
    -- the row is the only thing that actually answers it.
    select * into v_lab from public.lab_orders where id = txn.booking_order_id;
    v_cost := case
                when v_lab.id is not null
                 and v_lab.fulfilment = 'partner'
                then coalesce(v_lab.partner_cost_kobo, 0)
                else 0
              end;

    if v_cost > 0 then
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
-- 7. Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  -- Name, not just type: this is the check that would have caught the 2500
  -- collision that dry-running this migration actually hit.
  if not exists (select 1 from public.finance_accounts
                  where code = '2700' and name = 'Partner lab funds payable'
                    and account_type = 'liability' and normal_balance = 'credit') then
    raise exception '2700 is not the partner-liability account — the code is taken by "%"',
      coalesce((select name from public.finance_accounts where code = '2700'), 'nothing');
  end if;

  if pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%2700%' then
    raise exception 'the payment split is not posting to the partner liability account';
  end if;

  -- Every branch that existed before this migration still exists.
  if pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%Care voucher prepayment%'
   or pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%finance_create_recognition_schedule%'
   or pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%4900%' then
    raise exception 'a payment-posting branch was lost';
  end if;

  -- The below-cost guard must fire after the discount, or it guards nothing.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.lab_orders'::regclass
       and tgname = 'lab_orders_zz_never_below_partner_cost'
       and not tgisinternal
       and tgname > 'lab_orders_screening_subscriber_discount'
  ) then
    raise exception 'the below-cost guard is missing or would fire before the subscriber discount';
  end if;
end $$;
