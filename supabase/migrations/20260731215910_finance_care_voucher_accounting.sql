-- Care Vouchers, part 8: the accounting.
--
-- Two separate liabilities, and the separation is the point:
--   2100  Customer prepayments — care vouchers   (money customers actually paid)
--   2600  Reward vouchers outstanding            (promotional obligation, nobody paid)
-- Mixing them is what made wallet balances indistinguishable between customer
-- money and marketing credit. Being able to show that they were never
-- commingled is worth a great deal even when the closed-loop position is right.
--
-- Revenue timing: money in at purchase is a LIABILITY, not revenue. Revenue is
-- recognised when the voucher is redeemed and the service is actually
-- delivered. That is ordinary deferred-revenue treatment and it is also the
-- honest one — until redemption Tarragon owes a service.
--
-- BREAKAGE IS DELIBERATELY NOT RECOGNISED. An expired unredeemed voucher keeps
-- its 2100 liability standing rather than being released to revenue, because
-- expiry here is extendable on request and the obligation has not really gone
-- away. Recognising breakage automatically would book revenue for care never
-- given, on a balance a patient can still ask us to reinstate. Founder and
-- accountant can revisit once there is a real history of how many are
-- reinstated.

update public.finance_accounts
   set name = 'Customer prepayments — care vouchers',
       description = 'Money customers have paid for a named service not yet delivered. Segregated from reward vouchers (2600), which nobody paid for.'
 where code = '2100';

insert into public.finance_accounts
  (code, name, account_type, normal_balance, vat_treatment, sort_order, cash_flow_category, description)
values
  ('2600', 'Reward vouchers outstanding', 'liability', 'credit', 'exempt', 46, 'operating',
   'Promotional discount vouchers issued for referrals, prevention actions and wellness points. Nobody paid cash for these, so they are a marketing obligation and never customer money.')
on conflict (code) do nothing;

alter table public.finance_journal_lines drop constraint if exists finance_journal_lines_source_check;
alter table public.finance_journal_entries drop constraint if exists finance_journal_entries_source_check;
alter table public.finance_journal_entries add constraint finance_journal_entries_source_check
  check (source in ('payment','commission','refund','wallet','voucher','revenue_recognition','fx','manual','adjustment','opening'));

-- ---------------------------------------------------------------------------
-- Money in: a voucher instalment is a customer prepayment, not revenue.
-- Byte-identical to the live definition apart from the metadata key it matches
-- ('wallet_topup' -> 'voucher_payment'), the memo, and the source label.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_from_payment(p_txn_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
      'Booking payment — ' || coalesce(txn.booking_order_type::text,'service'),
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET')),
      null);

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
$$;

-- ---------------------------------------------------------------------------
-- Issue of a reward voucher: a marketing cost accrued when it is granted.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_reward_voucher_issued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'reward_discount' then return new; end if;
  perform private.finance_post_journal(
    current_date, 'NGN'::public.currency, 'voucher', 'reward:' || new.id::text,
    'Reward voucher issued — ' || coalesce(new.sku_name, 'care credit'),
    jsonb_build_array(
      jsonb_build_object('account_code','6000','debit_minor',new.face_value_kobo,'credit_minor',0,
                         'organisation_id',new.organisation_id,'cost_center_code','MARKETING'),
      jsonb_build_object('account_code','2600','debit_minor',0,'credit_minor',new.face_value_kobo,
                         'organisation_id',new.organisation_id)),
    null);
  return new;
exception when others then
  return new; -- accounting must never block issuing a reward
end;
$$;

create trigger care_vouchers_finance_issue
  after insert on public.care_vouchers
  for each row execute function private.finance_post_reward_voucher_issued();

-- ---------------------------------------------------------------------------
-- Redemption: the liability is discharged and revenue is finally earned.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_voucher_redeemed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_liability text;
begin
  if new.status <> 'redeemed' or old.status = 'redeemed' then return new; end if;
  v_liability := case when new.kind = 'prepaid_service' then '2100' else '2600' end;

  perform private.finance_post_journal(
    current_date, 'NGN'::public.currency, 'voucher', 'redeem:' || new.id::text,
    'Voucher redeemed — ' || coalesce(new.sku_name, 'care'),
    jsonb_build_array(
      jsonb_build_object('account_code',v_liability,'debit_minor',new.face_value_kobo,'credit_minor',0,
                         'organisation_id',new.organisation_id),
      jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',new.face_value_kobo,
                         'organisation_id',new.organisation_id,'cost_center_code','PARTNER_NET')),
    null);
  return new;
exception when others then
  return new; -- accounting must never block a patient getting their care
end;
$$;

create trigger care_vouchers_finance_redeem
  after update on public.care_vouchers
  for each row execute function private.finance_post_voucher_redeemed();

do $$
begin
  if not exists (select 1 from public.finance_accounts where code = '2600') then
    raise exception 'the reward voucher liability account was not created';
  end if;
  if (select name from public.finance_accounts where code = '2100') not ilike '%prepayment%' then
    raise exception '2100 was not renamed to reflect prepayments';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'finance_post_from_payment') ilike '%wallet_topup%' then
    raise exception 'the payment poster still looks for wallet top-ups';
  end if;
end $$;;
