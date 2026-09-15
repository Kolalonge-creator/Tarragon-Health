-- Tarragon Health — pharmacy settlement parity, part 1: collect + liability
-- (spec §25.19). Mirrors the laboratory treatment shipped 2026-08-21
-- (20260821191942_partner_billing_collect_and_liability.sql) for exactly
-- the same reason: private.finance_post_from_payment() currently posts a
-- pharmacy order's FULL patient payment straight to 4100 Booking & service
-- revenue. Almost none of that is Tarragon's — pharmacy_medications already
-- carries a real commission_rate/commission_rate_type/commission_flat_kobo
-- per drug, so most of the money collected on a pharmacy order belongs to
-- the pharmacy, exactly the same overstated-revenue problem the lab
-- migration's own header describes, just with a commission-based cost
-- model instead of lab's wholesale-cost model.
--
-- IMPORTANT CONTEXT for whoever reads this next: pharmacy already gained a
-- lot of real functionality very recently (partner onboarding, order
-- accept/decline, dispense-with-batch/expiry, a delivery fee, and a bare
-- refund_status/refund_amount_kobo/refund_ref flag pair on pharmacy_orders)
-- through migrations that are live on the database but are not — as of
-- this writing — present in this git repository under any branch this
-- session can see (checked: this branch, origin/main-dev, and the full
-- commit history of both). That is worth flagging to whoever owns this
-- repo's git hygiene; it is not this migration's job to fix. This migration
-- deliberately does not touch pharmacist_accept_order/pharmacist_decline_
-- order/record_pharmacy_commission — those are read from their live
-- definitions (pg_get_functiondef, not this repo's files) to build on top
-- of accurately, and are left exactly as they are.
--
-- record_pharmacy_commission() (private schema, AFTER UPDATE trigger on
-- payment_confirmed) already computes a commission figure for the separate
-- `commissions` receivables table, live, at the same status transition this
-- migration hooks. That computation is intentionally NOT reused here (reuse
-- would mean editing a trigger this session does not own the history of,
-- while it may still be in flight elsewhere) — private.compute_pharmacy_
-- partner_cost() below duplicates the same flat/percentage arithmetic
-- independently. Both read the same catalogue rates at the same moment, so
-- they should never disagree in practice; if a future session ever finds
-- them drifting, that is the seam to unify, not this comment.

-- ---------------------------------------------------------------------------
-- 1. The liability account, one code along from the laboratory's.
-- ---------------------------------------------------------------------------
insert into public.finance_accounts
  (code, name, account_type, normal_balance, vat_treatment, sort_order, description)
values
  ('2710', 'Partner pharmacy funds payable', 'liability', 'credit', 'exempt', 47,
   'Collected from patients for pharmacy orders and owed to the fulfilling pharmacy until a statement is agreed. Not revenue. Moves to 2500 Accounts payable when a pharmacy statement is approved.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. What we owe, recorded on the order — same snapshot-once discipline as
-- lab_orders.partner_cost_kobo: a later catalogue reprice must not change
-- what we believe we owe on an order already paid for.
-- ---------------------------------------------------------------------------
alter table public.pharmacy_orders
  add column if not exists partner_cost_kobo bigint check (partner_cost_kobo is null or partner_cost_kobo >= 0),
  add column if not exists partner_cost_provider_id uuid references public.pharmacy_partners (id) on delete restrict,
  add column if not exists partner_cost_breakdown jsonb;

comment on column public.pharmacy_orders.partner_cost_kobo is
  'What is owed to the fulfilling pharmacy for this order (line total minus Tarragon''s commission), snapshotted the moment payment is confirmed. This is the liability; total_kobo is what the patient pays; the difference is Tarragon''s commission. Never recomputed.';
comment on column public.pharmacy_orders.partner_cost_provider_id is
  'Always pharmacy_orders.pharmacy_partner_id at the moment of snapshot — pharmacy orders (unlike lab orders) never need provider resolution, since the fulfilling pharmacy is already named directly on the order.';
comment on column public.pharmacy_orders.partner_cost_breakdown is
  'Per-item snapshot at payment confirmation: [{"medication_id","quantity","price_kobo","commission_kobo","partner_cost_kobo"}]. The audit trail behind partner_cost_kobo, and what a partner statement line is matched against.';

-- ---------------------------------------------------------------------------
-- 3. The commission/cost split, computed from pharmacy_medications' own
-- rate columns — same flat-vs-percentage arithmetic record_pharmacy_
-- commission() already uses, kept independent per the header note above.
-- ---------------------------------------------------------------------------
create or replace function private.compute_pharmacy_partner_cost(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item record;
  med record;
  v_line_price bigint;
  v_line_commission bigint;
  v_total_price bigint := 0;
  v_total_commission bigint := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_missing uuid[] := '{}';
begin
  for item in
    select * from jsonb_to_recordset(p_items) as x(medication_id uuid, price_kobo bigint, quantity int)
  loop
    select commission_rate_type, commission_rate, commission_flat_kobo
      into med
      from public.pharmacy_medications
      where id = item.medication_id;

    if not found then
      -- A medication no longer in the catalogue (deactivated, removed) is not
      -- a rounding problem: we would be taking payment with no rate on file
      -- for what Tarragon owes the pharmacy for it.
      v_missing := v_missing || item.medication_id;
      continue;
    end if;

    v_line_price := coalesce(item.price_kobo, 0) * coalesce(item.quantity, 1);
    v_line_commission := case
      when med.commission_rate_type = 'flat' then coalesce(med.commission_flat_kobo, 0) * coalesce(item.quantity, 1)
      else round(v_line_price * coalesce(med.commission_rate, 0))
    end;

    v_total_price := v_total_price + v_line_price;
    v_total_commission := v_total_commission + v_line_commission;
    v_breakdown := v_breakdown || jsonb_build_object(
      'medication_id', item.medication_id,
      'quantity', item.quantity,
      'price_kobo', v_line_price,
      'commission_kobo', v_line_commission,
      'partner_cost_kobo', v_line_price - v_line_commission
    );
  end loop;

  return jsonb_build_object(
    'ok', array_length(v_missing, 1) is null,
    'missing_medication_ids', to_jsonb(v_missing),
    'total_price_kobo', v_total_price,
    'commission_kobo', v_total_commission,
    'partner_cost_kobo', v_total_price - v_total_commission,
    'breakdown', v_breakdown
  );
end;
$$;

revoke all on function private.compute_pharmacy_partner_cost(jsonb) from public;

-- ---------------------------------------------------------------------------
-- 4. Snapshot at the same transition record_pharmacy_commission() already
-- hooks (old.status IS DISTINCT FROM new.status AND new.status =
-- 'payment_confirmed') — same moment, independent trigger, so this can be
-- added or removed without touching the one that already exists.
-- ---------------------------------------------------------------------------
create or replace function private.snapshot_pharmacy_order_partner_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost jsonb;
begin
  v_cost := private.compute_pharmacy_partner_cost(new.items);

  if not coalesce((v_cost ->> 'ok')::boolean, false) then
    raise exception 'One or more items on this order are not in the pharmacy catalogue — cannot determine what is owed to the pharmacy for them.'
      using errcode = '23514';
  end if;

  new.partner_cost_kobo := (v_cost ->> 'partner_cost_kobo')::bigint;
  new.partner_cost_provider_id := new.pharmacy_partner_id;
  new.partner_cost_breakdown := v_cost -> 'breakdown';

  return new;
end;
$$;

revoke all on function private.snapshot_pharmacy_order_partner_cost() from public;

drop trigger if exists pharmacy_orders_snapshot_partner_cost on public.pharmacy_orders;
create trigger pharmacy_orders_snapshot_partner_cost
  before update on public.pharmacy_orders
  for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed')
  execute function private.snapshot_pharmacy_order_partner_cost();

-- ---------------------------------------------------------------------------
-- 5. The payment split — extends private.finance_post_from_payment(), built
-- from its actual live definition (pulled via pg_get_functiondef, not this
-- repo's own committed copy of the lab migration, since the two have
-- already been shown to diverge once before). Every existing branch —
-- lab, subscription, add-on, voucher, and the generic fallback — is
-- preserved verbatim; only the booking branch gains a pharmacy case
-- alongside the existing lab case.
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
-- 6. Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.finance_accounts
                  where code = '2710' and name = 'Partner pharmacy funds payable'
                    and account_type = 'liability' and normal_balance = 'credit') then
    raise exception '2710 is not the partner-pharmacy-liability account — the code is taken by "%"',
      coalesce((select name from public.finance_accounts where code = '2710'), 'nothing');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pharmacy_orders' and column_name = 'partner_cost_kobo'
  ) then
    raise exception 'FAIL: pharmacy_orders.partner_cost_kobo was not added';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.pharmacy_orders'::regclass
       and tgname = 'pharmacy_orders_snapshot_partner_cost'
       and not tgisinternal
  ) then
    raise exception 'FAIL: pharmacy_orders_snapshot_partner_cost trigger is missing';
  end if;

  if pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%2710%' then
    raise exception 'the payment split is not posting to the pharmacy partner liability account';
  end if;

  -- Every branch that existed before this migration still exists.
  if pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%2700%'
   or pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%Care voucher prepayment%'
   or pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%finance_create_recognition_schedule%'
   or pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%4900%' then
    raise exception 'a pre-existing payment-posting branch was lost';
  end if;

  raise notice 'PASS: pharmacy partner liability account, cost snapshot, and payment split extension all in place';
end $$;
