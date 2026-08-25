-- Principal or agent, as a decision the accountant makes with an UPDATE.
--
-- THE TWO QUESTIONS ARE SEPARATE, AND CONFLATING THEM IS THE MISTAKE
-- ------------------------------------------------------------------
-- "Money we are holding for Synlab is not ours" is a BALANCE SHEET fact, and
-- it is true under every treatment. That part is already built and does not
-- change here: the partner's share credits 2700 the moment the patient pays,
-- and it stays a liability until a statement is agreed.
--
-- "Is Tarragon's revenue the whole 227,500 or only the 37,700 margin" is a
-- completely different question — a PROFIT AND LOSS presentation question,
-- answered by IFRS 15's principal-versus-agent test. It changes no cash, no
-- liability, and nothing Synlab is owed. It changes reported revenue by about
-- five times, which is exactly the number a bank, an investor or FIRS will
-- read first.
--
-- The indicators genuinely point both ways, which is why this is not a call to
-- make in a migration:
--   toward PRINCIPAL — Tarragon decides which tests are done, sets the patient
--     price with full discretion, and is the party the patient holds
--     responsible when a result is wrong or late.
--   toward AGENT — Tarragon never takes control of the laboratory service
--     before it is delivered, cannot substitute another provider, and carries
--     no inventory risk: under the refund policy already shipped, a patient
--     who never attends means Synlab is never paid.
--
-- So both treatments are implemented, the choice is one row of data, and the
-- default is the net/agent presentation the founder originally asked for.
-- Changing it later is an UPDATE and a re-post of any affected period, not a
-- migration and not a rewrite.

-- ---------------------------------------------------------------------------
-- 1. The cost account the gross treatment needs.
-- ---------------------------------------------------------------------------
insert into public.finance_accounts
  (code, name, account_type, normal_balance, vat_treatment, sort_order, description)
values
  ('5100', 'Cost of laboratory services', 'expense', 'debit', 'exempt', 84,
   'What partner laboratories charge Tarragon for tests delivered to patients. Only used under the gross/principal revenue treatment; under net/agent the same amount never touches the profit and loss at all.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The choice.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.partner_revenue_treatment as enum ('net_agent', 'gross_principal');
exception when duplicate_object then null; end $$;

create table if not exists public.finance_partner_revenue_policy (
  id          boolean primary key default true check (id),
  treatment   public.partner_revenue_treatment not null default 'net_agent',
  decided_by  text,
  decided_at  timestamptz,
  note        text not null,
  updated_at  timestamptz not null default now()
);

comment on table public.finance_partner_revenue_policy is
  'One row, ever (id is a checked boolean primary key). How partner laboratory income is presented in the profit and loss. net_agent = only Tarragon''s margin is revenue. gross_principal = the full patient price is revenue and the laboratory''s charge is cost of sales. The balance sheet is identical either way; decided_by should name the accountant who made the call.';

insert into public.finance_partner_revenue_policy (id, treatment, note)
values (true, 'net_agent',
  'Default, and what the founder asked for: money held for the laboratory is a liability, not income. NOT yet reviewed by an accountant — the principal indicators (price discretion, responsibility to the patient) are strong enough that this should be confirmed before any figure leaves the building.')
on conflict (id) do nothing;

alter table public.finance_partner_revenue_policy enable row level security;
drop policy if exists finance_partner_revenue_policy_select on public.finance_partner_revenue_policy;
create policy finance_partner_revenue_policy_select on public.finance_partner_revenue_policy
  for select to authenticated using (true);
grant select on public.finance_partner_revenue_policy to authenticated;
revoke all on public.finance_partner_revenue_policy from anon;

create or replace function private.partner_revenue_treatment()
returns public.partner_revenue_treatment
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select treatment from public.finance_partner_revenue_policy where id), 'net_agent');
$$;

revoke all on function private.partner_revenue_treatment() from public;

-- ---------------------------------------------------------------------------
-- 3. Collection posts whichever presentation is chosen.
--
-- Supersedes the collect migration's copy. Only the partner-lab branch
-- changes; every other branch is preserved byte-for-byte.
--
--   net_agent        Dr 1020 A       Cr 2700 C, and 4100 takes A - C on
--                                    whichever side it falls.
--   gross_principal  Dr 1020 A       Cr 4100 A      (the whole price is revenue)
--                    Dr 5100 C       Cr 2700 C      (and the lab is a cost)
--
-- Both balance, both credit 2700 with exactly the same liability, and both
-- move exactly the same cash. Under gross the voucher over-recognition problem
-- disappears rather than needing the netting trick: voucher redemption already
-- credited 4100 with the voucher's value, this credits it with the card's, and
-- together they are the full price.
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
  v_treatment public.partner_revenue_treatment;
  v_lab_name text;
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
    select * into v_lab from public.lab_orders where id = txn.booking_order_id;
    v_cost := case
                when v_lab.id is not null and v_lab.fulfilment = 'partner'
                then coalesce(v_lab.partner_cost_kobo, 0)
                else 0
              end;

    if v_cost > 0 then
      v_treatment := private.partner_revenue_treatment();
      select name into v_lab_name from public.lab_providers where id = v_lab.partner_cost_provider_id;

      if v_treatment = 'gross_principal' then
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,
                             'organisation_id',txn.organisation_id,
                             'memo','Patient payment for lab order ' || coalesce(v_lab.order_number, v_lab.id::text)),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,
                             'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                             'memo','Review sold to the patient (gross)'),
          jsonb_build_object('account_code','5100','debit_minor',v_cost,'credit_minor',0,
                             'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                             'counterparty',v_lab_name,
                             'memo','Cost of the laboratory work'),
          jsonb_build_object('account_code','2700','debit_minor',0,'credit_minor',v_cost,
                             'organisation_id',txn.organisation_id,'counterparty',v_lab_name,
                             'memo','Owed to the laboratory for this order'));
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,
                             'organisation_id',txn.organisation_id,
                             'memo','Patient payment for lab order ' || coalesce(v_lab.order_number, v_lab.id::text)),
          jsonb_build_object('account_code','2700','debit_minor',0,'credit_minor',v_cost,
                             'organisation_id',txn.organisation_id,'counterparty',v_lab_name,
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
      end if;

      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Lab review payment — partner-billed (' || v_treatment::text || ')', v_lines, null);
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
-- 4. And so does a refund.
--
-- Leaving refunds on one treatment while collection follows another would
-- quietly build a permanent error into the accounts, growing with every
-- refund. Under gross the whole refund is contra-revenue because the whole
-- price was revenue; the laboratory's share is unwound against cost of sales
-- instead of against the margin.
-- ---------------------------------------------------------------------------
create or replace function public.approve_lab_order_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r         public.lab_order_refunds%rowtype;
  v_lines     jsonb := '[]'::jsonb;
  v_entry     uuid;
  v_treatment public.partner_revenue_treatment;
begin
  select * into v_r from public.lab_order_refunds where id = p_refund_id;
  if v_r.id is null then
    raise exception 'no such refund' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_r.organisation_id) then
    raise exception 'only care-team staff can approve a refund' using errcode = '42501';
  end if;
  if v_r.status <> 'requested' then
    raise exception 'this refund is already %', v_r.status using errcode = '23514';
  end if;

  v_treatment := private.partner_revenue_treatment();

  if v_treatment = 'gross_principal' then
    -- The entire amount was recognised as revenue, so the entire amount
    -- reverses through contra-revenue.
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','4900','debit_minor',v_r.refund_total_kobo,'credit_minor',0,
                         'organisation_id',v_r.organisation_id,
                         'memo','Refunded to the patient'),
      jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',v_r.refund_total_kobo,
                         'organisation_id',v_r.organisation_id,
                         'memo','Owed back to the patient'));

    -- And where the laboratory is not owed, its cost unwinds too.
    if v_r.partner_portion_kobo > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code','2700','debit_minor',v_r.partner_portion_kobo,'credit_minor',0,
                           'organisation_id',v_r.organisation_id,
                           'memo','Released — the laboratory is not owed for this order'),
        jsonb_build_object('account_code','5100','debit_minor',0,'credit_minor',v_r.partner_portion_kobo,
                           'organisation_id',v_r.organisation_id,
                           'memo','Laboratory cost reversed with it'));
    end if;
  else
    if v_r.partner_portion_kobo > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code','2700','debit_minor',v_r.partner_portion_kobo,'credit_minor',0,
                           'organisation_id',v_r.organisation_id,
                           'memo','Released — the laboratory is not owed for this order'));
    end if;
    if v_r.margin_portion_kobo > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code','4900','debit_minor',v_r.margin_portion_kobo,'credit_minor',0,
                           'organisation_id',v_r.organisation_id,
                           'memo','Refunded to the patient at Tarragon''s cost'));
    end if;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',v_r.refund_total_kobo,
                         'organisation_id',v_r.organisation_id,
                         'memo','Owed back to the patient'));
  end if;

  v_entry := private.finance_post_journal(
    current_date, 'NGN', 'lab_refund', p_refund_id::text,
    'Laboratory order refund — ' || v_r.reason::text || ' (' || v_treatment::text || ')', v_lines, null);

  update public.lab_order_refunds
     set status = 'approved', approved_by = (select auth.uid()),
         approved_at = now(), journal_entry_id = v_entry
   where id = p_refund_id;

  return jsonb_build_object('ok', true, 'journal_entry_id', v_entry, 'treatment', v_treatment);
end;
$$;

revoke all on function public.approve_lab_order_refund(uuid) from public;
grant execute on function public.approve_lab_order_refund(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.finance_partner_revenue_policy) <> 1 then
    raise exception 'the revenue policy must be exactly one row';
  end if;
  if private.partner_revenue_treatment() <> 'net_agent' then
    raise exception 'the default treatment should be net_agent, the one the founder asked for';
  end if;
  if not exists (select 1 from public.finance_accounts
                  where code = '5100' and name = 'Cost of laboratory services' and account_type = 'expense') then
    raise exception '5100 is not the laboratory cost account — the code is taken by "%"',
      coalesce((select name from public.finance_accounts where code = '5100'), 'nothing');
  end if;

  -- Both branches exist in both functions. A treatment implemented on
  -- collection but not on refunds would build a permanent, growing error.
  if pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%gross_principal%'
   or pg_get_functiondef('public.approve_lab_order_refund(uuid)'::regprocedure) not like '%gross_principal%' then
    raise exception 'the gross treatment is not implemented on both collection and refunds';
  end if;
end $$;
