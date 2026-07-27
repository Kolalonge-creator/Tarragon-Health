-- Tarragon Health — Finance: connect automated postings to cost centers +
-- suggest a real filing amount from the ledger.
--
-- The cost-centers migration let a journal LINE carry a cost_center_code, but
-- the automated posting functions (payments, commissions, settlements) never
-- actually set one — so "P&L by cost center" showed everything as
-- "Unassigned" except whatever a human manually tagged on a journal entry or
-- an AP bill. This closes that gap for the automated flows where a cost
-- center genuinely applies (expense-side attribution, and the two revenue
-- lines this codebase's own account descriptions already name as
-- department-specific): booking/service revenue and partner commission
-- income → PARTNER_NET (Booking & service revenue / Commission income are
-- both explicitly the partner-network's line per finance_accounts.description);
-- settlement processing fees → OPS_ADMIN (a real recurring operating cost).
-- Subscription/add-on revenue and wallet top-ups are core platform revenue
-- with no single owning department, so they deliberately stay unassigned —
-- forcing a cost center onto every line would misrepresent this ledger's
-- actual DNA, not make it more "connected".

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

  if txn.booking_order_id is not null then
    v_kind := 'booking';
  elsif txn.subscription_id is not null then
    v_kind := 'subscription';
  elsif txn.subscription_add_on_id is not null then
    v_kind := 'add_on';
  elsif coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}') = 'wallet_topup' then
    v_kind := 'wallet';
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

  elsif v_kind = 'wallet' then
    perform private.finance_post_journal(v_date, v_cur, 'wallet', txn.id::text,
      'Wallet top-up',
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
end; $$;

-- Only the 'earned' leg's revenue line is tagged — the later 'collected' leg
-- just moves already-recognised cash and would double-count the attribution.
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
                         'organisation_id',c.organisation_id,'counterparty',c.partner_name,'cost_center_code','PARTNER_NET')),
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

create or replace function public.finance_post_settlement(p_settlement_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  st public.finance_settlements%rowtype;
  v_entry uuid;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  select * into st from public.finance_settlements where id = p_settlement_id;
  if st.id is null then raise exception 'settlement not found'; end if;
  if st.status = 'reconciled' then return st.journal_entry_id; end if;
  if st.gross_minor <> st.net_minor + st.fees_minor then
    raise exception 'settlement does not balance: gross % <> net % + fees % (variance %)',
      st.gross_minor, st.net_minor, st.fees_minor, st.gross_minor - (st.net_minor + st.fees_minor)
      using errcode = 'check_violation';
  end if;

  v_entry := private.finance_post_journal(
    st.settlement_date, st.currency, 'payment', 'settlement:' || st.id::text,
    'Settlement ' || st.provider::text || coalesce(' ' || st.external_ref, ''),
    jsonb_build_array(
      jsonb_build_object('account_code', st.bank_account_code, 'debit_minor', st.net_minor, 'credit_minor', 0,
                         'counterparty', st.provider::text),
      jsonb_build_object('account_code', '5000', 'debit_minor', st.fees_minor, 'credit_minor', 0,
                         'counterparty', st.provider::text, 'cost_center_code', 'OPS_ADMIN'),
      jsonb_build_object('account_code', '1020', 'debit_minor', 0, 'credit_minor', st.gross_minor,
                         'counterparty', st.provider::text)
    ),
    (select auth.uid()));

  update public.finance_settlements
    set status = 'reconciled', journal_entry_id = v_entry
    where id = st.id;
  perform private.log_audit('finance.settlement.post', 'finance_settlements', p_settlement_id,
    jsonb_build_object('journal_entry_id', v_entry, 'gross_minor', st.gross_minor));
  return v_entry;
end; $$;

-- ---------------------------------------------------------------------------
-- Suggest a real filing amount for VAT/WHT from the ledger's own authoritative
-- balances, so "mark as filed" isn't a blind manual number. Only meaningful
-- for the two tax-account-backed monthly obligations; other obligation types
-- return null (pension/PAYE/NHF have no payroll ledger to derive from yet —
-- the platform has no payroll subsystem, so those stay genuinely manual).
-- ---------------------------------------------------------------------------
create or replace function public.finance_compliance_suggested_amount(p_obligation_code text, p_period_label text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date;
  v_amount bigint;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  if p_obligation_code not in ('vat_monthly','wht_monthly') then return '{}'::jsonb; end if;
  v_month := to_date(p_period_label || '-01', 'YYYY-MM-DD');

  if p_obligation_code = 'vat_monthly' then
    select coalesce(sum(case when l.account_code='2200' then l.credit_minor-l.debit_minor
                             when l.account_code='1300' then -(l.debit_minor-l.credit_minor) else 0 end),0)
      into v_amount
    from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
    where l.account_code in ('2200','1300') and l.currency='NGN'
      and e.entry_date >= v_month and e.entry_date < (v_month + interval '1 month')::date;
  else
    select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_amount
    from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
    where l.account_code='2300' and l.currency='NGN'
      and e.entry_date >= v_month and e.entry_date < (v_month + interval '1 month')::date;
  end if;

  return jsonb_build_object('suggested_amount_minor', v_amount, 'currency', 'NGN',
    'basis', 'computed from the ledger''s tax accounts for this period — confirm before remitting');
end; $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'finance\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
