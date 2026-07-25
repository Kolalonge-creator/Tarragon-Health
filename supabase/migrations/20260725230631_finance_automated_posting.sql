-- Tarragon Health — Finance: automated GL posting from real platform events.
--
-- payment_transactions (webhook-written source of truth) → ledger; commissions →
-- ledger. Every posting is idempotent (one journal entry per source row) and
-- WRAPPED so a finance-posting failure can NEVER abort the payment webhook's own
-- write (money processing must not depend on bookkeeping succeeding) — failures
-- RAISE WARNING and leave the row un-booked for later manual posting.

-- ---------------------------------------------------------------------------
-- Post one payment_transactions row (money-in / refund) into the ledger.
-- Subscriptions/add-ons land in Deferred revenue + open a rev-rec schedule;
-- bookings recognise at point of sale; wallet top-ups are a customer liability.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_from_payment(p_txn_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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

  -- classify by the webhook's enrichment columns, falling back to metadata.kind
  if txn.booking_order_id is not null then
    v_kind := 'booking';
  elsif txn.subscription_id is not null then
    v_kind := 'subscription';
  elsif txn.subscription_add_on_id is not null then
    v_kind := 'add_on';
  elsif coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}') = 'wallet_topup' then
    v_kind := 'wallet';
  else
    return;  -- unrecognised money event — leave for manual posting
  end if;

  if v_kind = 'booking' then
    perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
      'Booking payment — ' || coalesce(txn.booking_order_type::text,'service'),
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id)),
      null);

  elsif v_kind = 'wallet' then
    perform private.finance_post_journal(v_date, v_cur, 'wallet', txn.id::text,
      'Wallet top-up',
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','2100','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id)),
      null);

  else
    -- subscription / add_on: full amount to Deferred revenue, then a rev-rec schedule
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
end; $$;

-- Trigger: exception-guarded so finance never blocks the webhook write.
create or replace function private.finance_on_payment_processed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.processed_at is not null and (tg_op = 'INSERT' or old.processed_at is null) then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      raise warning 'finance_on_payment_processed: posting failed for txn % (%)', new.id, sqlerrm;
    end;
  end if;
  return new;
end; $$;

create trigger finance_post_payment_processed
  after insert or update of processed_at on public.payment_transactions
  for each row execute function private.finance_on_payment_processed();

-- ---------------------------------------------------------------------------
-- Commissions → ledger. Earned: Dr Commission receivable, Cr Commission income.
-- Collected (status→paid): Dr Bank, Cr Commission receivable. Both idempotent
-- and exception-guarded.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_commission(p_commission_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.commissions%rowtype;
begin
  select * into c from public.commissions where id = p_commission_id;
  if c.id is null or coalesce(c.amount_kobo,0) <= 0 then return; end if;

  perform private.finance_post_journal(coalesce(c.earned_at::date, current_date), 'NGN', 'commission',
    'earned:' || c.id::text, 'Commission earned — ' || coalesce(c.partner_name,'partner'),
    jsonb_build_array(
      jsonb_build_object('account_code','1200','debit_minor',c.amount_kobo,'credit_minor',0,
                         'organisation_id',c.organisation_id,'counterparty',c.partner_name),
      jsonb_build_object('account_code','4200','debit_minor',0,'credit_minor',c.amount_kobo,
                         'organisation_id',c.organisation_id,'counterparty',c.partner_name)),
    null);

  if c.status = 'paid' then
    perform private.finance_post_journal(coalesce(c.paid_at::date, current_date), 'NGN', 'commission',
      'collected:' || c.id::text, 'Commission collected — ' || coalesce(c.partner_name,'partner'),
      jsonb_build_array(
        jsonb_build_object('account_code','1000','debit_minor',c.amount_kobo,'credit_minor',0,
                           'organisation_id',c.organisation_id,'counterparty',c.partner_name),
        jsonb_build_object('account_code','1200','debit_minor',0,'credit_minor',c.amount_kobo,
                           'organisation_id',c.organisation_id,'counterparty',c.partner_name)),
      null);
  end if;
end; $$;

create or replace function private.finance_on_commission_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.finance_post_commission(new.id);
  exception when others then
    raise warning 'finance_on_commission_change: posting failed for commission % (%)', new.id, sqlerrm;
  end;
  return new;
end; $$;

create trigger finance_post_commission_change
  after insert or update of status on public.commissions
  for each row execute function private.finance_on_commission_change();

-- ---------------------------------------------------------------------------
-- Backfill existing processed payments + commissions.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.payment_transactions where processed_at is not null loop
    begin perform private.finance_post_from_payment(r.id);
    exception when others then raise warning 'backfill payment % failed: %', r.id, sqlerrm; end;
  end loop;
  for r in select id from public.commissions loop
    begin perform private.finance_post_commission(r.id);
    exception when others then raise warning 'backfill commission % failed: %', r.id, sqlerrm; end;
  end loop;
end $$;
