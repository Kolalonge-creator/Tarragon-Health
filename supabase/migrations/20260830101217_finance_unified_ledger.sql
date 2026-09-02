-- Tarragon Health — Finance: unified transaction ledger read (§91.12).
--
-- §91 gap analysis found `payment_transactions` (a webhook event log) and
-- `finance_journal_entries`/`finance_journal_lines` (the double-entry GL) are
-- both real but disjoint — no single row carries payer + recipient + service
-- + amount + currency + status + timestamp + method together.
--
-- Design note (discovered by reading the LIVE `private.finance_post_from_payment`
-- definition, not the original migration file — it has drifted well beyond
-- what's on disk, per the standing "check live before assuming" lesson):
-- every `finance_journal_entries` row with source in ('payment','refund'), and
-- the voucher-prepayment case of source='voucher', is already posted with
-- `source_ref = <payment_transactions.id>::text`. That means the two tables
-- are ALREADY linked structurally — no new FK column or trigger rewiring is
-- needed, only a read-side join. This is a smaller, safer, and more accurate
-- design than the original plan sketch (which assumed no such link existed).
--
-- All access is via this SECURITY DEFINER RPC only — no new table, so no new
-- RLS surface to reason about.

-- ---------------------------------------------------------------------------
-- Resolve the profile who is the counterparty (payer) of a payment_transactions
-- row, trying every known linkage path. Returns null rather than guessing for
-- anything unrecognised (e.g. a booking_order_type this function doesn't yet
-- cover) — a missing payer is honest; a wrong one is not.
-- ---------------------------------------------------------------------------
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
    case p_txn.booking_order_type::text
      when 'lab' then (select patient_id from public.lab_orders where id = p_txn.booking_order_id)
      when 'pharmacy' then (select patient_id from public.pharmacy_orders where id = p_txn.booking_order_id)
      when 'referral' then (select patient_id from public.specialist_referrals where id = p_txn.booking_order_id)
      else null
    end
  );
$$;

revoke all on function private.resolve_payment_payer(public.payment_transactions) from public, anon;

-- ---------------------------------------------------------------------------
-- Human-readable label for what a payment transaction actually paid for.
-- ---------------------------------------------------------------------------
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
    else 'Payment'
  end;
$$;

revoke all on function private.payment_transaction_service_label(public.payment_transactions) from public, anon;

-- ---------------------------------------------------------------------------
-- The unified ledger read. Two modes, mutually exclusive in practice:
--   - p_profile_id: a patient's own history (or finance staff looking up one
--     patient). Rows are filtered to where that profile resolves as payer —
--     a sponsor's own payments show under the SPONSOR's profile, not the
--     beneficiary's, matching how payment_transactions/subscriptions already
--     attribute a sponsored charge.
--   - p_organisation_id: finance-staff-only, unfiltered by profile, for the
--     org's whole ledger. No institution/aggregate mode yet — that is a
--     separate, more restrictive design (see the subsidy-engine phase).
-- ---------------------------------------------------------------------------
create or replace function public.finance_unified_ledger(
  p_profile_id uuid default null,
  p_organisation_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  entry_id uuid,
  payment_transaction_id uuid,
  entry_date date,
  posted_at timestamptz,
  source text,
  service_label text,
  payer_profile_id uuid,
  payer_label text,
  recipient_label text,
  direction text,
  amount_minor bigint,
  currency public.currency,
  status text,
  method text,
  memo text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile_id is null and p_organisation_id is null then
    raise exception 'finance_unified_ledger requires p_profile_id or p_organisation_id'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_profile_id is not null
     and p_profile_id is distinct from (select auth.uid())
     and not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_organisation_id is not null and not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  with rows as (
    select
      je.id as entry_id,
      pt.id as payment_transaction_id,
      je.entry_date,
      je.created_at as posted_at,
      je.source,
      coalesce(private.payment_transaction_service_label(pt), initcap(je.source)) as service_label,
      private.resolve_payment_payer(pt) as payer_profile_id,
      (case when je.source = 'refund' then 'money_out' else 'money_in' end) as direction,
      coalesce(pt.amount_minor, 0) as amount_minor,
      je.currency,
      'completed'::text as status,
      pt.provider::text as method,
      je.memo,
      coalesce(pt.organisation_id,
        (select l.organisation_id from public.finance_journal_lines l
          where l.entry_id = je.id and l.organisation_id is not null limit 1)) as organisation_id
    from public.finance_journal_entries je
    left join public.payment_transactions pt on pt.id::text = je.source_ref
    where je.entry_date >= coalesce(p_from, '1900-01-01'::date)
      and je.entry_date <= coalesce(p_to, '9999-12-31'::date)

    union all

    select
      null::uuid as entry_id,
      pt.id as payment_transaction_id,
      pt.created_at::date as entry_date,
      pt.created_at as posted_at,
      'payment'::text as source,
      coalesce(private.payment_transaction_service_label(pt), 'Payment attempt') as service_label,
      private.resolve_payment_payer(pt) as payer_profile_id,
      'money_in'::text as direction,
      coalesce(pt.amount_minor, 0) as amount_minor,
      pt.currency,
      'failed'::text as status,
      pt.provider::text as method,
      pt.error as memo,
      pt.organisation_id
    from public.payment_transactions pt
    where pt.error is not null
      and not exists (select 1 from public.finance_journal_entries je2 where je2.source_ref = pt.id::text)
      and pt.created_at::date >= coalesce(p_from, '1900-01-01'::date)
      and pt.created_at::date <= coalesce(p_to, '9999-12-31'::date)
  )
  select
    r.entry_id, r.payment_transaction_id, r.entry_date, r.posted_at, r.source,
    r.service_label, r.payer_profile_id,
    case when r.direction = 'money_in'
      then coalesce(nullif(trim(pr.full_name), ''), 'Patient')
      else 'Tarragon Health' end as payer_label,
    case when r.direction = 'money_in'
      then 'Tarragon Health'
      else coalesce(nullif(trim(pr.full_name), ''), 'Patient') end as recipient_label,
    r.direction, r.amount_minor, r.currency, r.status, r.method, r.memo
  from rows r
  left join public.profiles pr on pr.id = r.payer_profile_id
  where (p_profile_id is null or r.payer_profile_id = p_profile_id)
    and (p_organisation_id is null or r.organisation_id = p_organisation_id)
  order by r.posted_at desc
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) from public;
revoke all on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) from anon;
revoke all on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — prove the function exists, is locked down, and anon has no path in.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'finance_unified_ledger'
  ) then
    raise exception 'finance_unified_ledger was not created';
  end if;

  if has_function_privilege('anon', 'public.finance_unified_ledger(uuid, uuid, date, date, integer, integer)', 'EXECUTE') then
    raise exception 'anon must never execute finance_unified_ledger';
  end if;

  if not has_function_privilege('authenticated', 'public.finance_unified_ledger(uuid, uuid, date, date, integer, integer)', 'EXECUTE') then
    raise exception 'authenticated should be able to call finance_unified_ledger (RPC itself gates by identity)';
  end if;
end $$;
