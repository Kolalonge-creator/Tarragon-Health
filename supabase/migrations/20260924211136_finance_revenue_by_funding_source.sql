-- Finance dashboard: revenue by funding source.
--
-- Gap found in the same audit that produced the previous migration
-- (20260924211113): nothing on the finance dashboard distinguished real cash
-- revenue (Paystack, or platform-credit paid_balance) from promo/voucher-
-- funded revenue (a reward_discount voucher, or platform-credit
-- promo_balance) — everything blends into the same "Revenue" tiles. This is
-- a pure read-side addition: no new GL accounts, no change to what net
-- income is — it just surfaces the split that the ledger's own account-level
-- segregation (1020/2100 = real money, 2600 = promotional, never
-- commingled — see 20260731215910's header) already makes possible.
--
-- METHOD.
--   * Point-of-sale revenue (source in 'payment'/'voucher'/'platform_credit',
--     credited straight to a revenue account) is classified by the SAME
--     journal entry's debit leg: 1020 (processor clearing) or 2100
--     (customer prepayment / a real prepaid_service voucher) is cash
--     actually collected; 2600 (promotional credit outstanding) was never
--     real money.
--   * Recognised (previously-deferred) revenue always debits 2000, which by
--     itself doesn't distinguish funding source — so it's traced back
--     through the schedule to whatever funded the underlying
--     service_purchase (the only source_kind a voucher/platform-credit can
--     ever fund): a proportional split of card remainder + platform-credit
--     paid_balance + a prepaid_service voucher (cash) vs platform-credit
--     promo_balance + a reward_discount voucher (promotional), applied to
--     the amount actually recognised this period. A subscription/add_on-
--     sourced schedule (no longer creatable — subscription plans were
--     retired 2026-09-02, see CLAUDE.md) has no promo/voucher mechanism at
--     all and is treated as fully cash.

create or replace function public.finance_revenue_by_funding_source(
  p_period_start date default date_trunc('month', current_date)::date,
  p_period_end date default current_date,
  p_currency text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cur public.currency := coalesce(p_currency, 'NGN')::public.currency;
  v_cash bigint := 0;
  v_promo bigint := 0;
  v_unclassified bigint := 0;
  v_recog_cash bigint := 0;
  v_recog_promo bigint := 0;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;

  with immediate as (
    select
      l.credit_minor as amt,
      (select l2.account_code from public.finance_journal_lines l2
        where l2.entry_id = e.id and l2.debit_minor > 0 limit 1) as debit_account
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    join public.finance_accounts a on a.code = l.account_code
    where a.account_type = 'revenue' and l.currency = v_cur
      and e.source in ('payment', 'voucher', 'platform_credit')
      and e.entry_date between p_period_start and p_period_end
      and l.credit_minor > 0
  )
  select
    coalesce(sum(amt) filter (where debit_account in ('1020', '2100')), 0),
    coalesce(sum(amt) filter (where debit_account = '2600'), 0),
    coalesce(sum(amt) filter (where debit_account not in ('1020', '2100', '2600') or debit_account is null), 0)
  into v_cash, v_promo, v_unclassified
  from immediate;

  with recog as (
    select
      l.credit_minor as amt,
      nullif(split_part(e.source_ref, ':', 2), '')::uuid as schedule_id
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    join public.finance_accounts a on a.code = l.account_code
    where a.account_type = 'revenue' and l.currency = v_cur
      and e.source = 'revenue_recognition'
      and e.entry_date between p_period_start and p_period_end
      and l.credit_minor > 0
  ),
  funded as (
    select
      r.amt,
      case when s.source_kind <> 'service_purchase' then r.amt
           else round(r.amt * coalesce(f.cash_ratio, 1))
      end as cash_amt,
      case when s.source_kind <> 'service_purchase' then 0
           else round(r.amt * coalesce(f.promo_ratio, 0))
      end as promo_amt
    from recog r
    left join public.revenue_recognition_schedules s on s.id = r.schedule_id
    left join lateral (
      select
        case when p.amount_kobo > 0 then
          ((p.amount_kobo - p.voucher_covered_kobo - coalesce(pc.paid_kobo, 0) - coalesce(pc.promo_kobo, 0))
           + coalesce(pc.paid_kobo, 0)
           + (case when v.kind = 'prepaid_service' then p.voucher_covered_kobo else 0 end)
          )::numeric / p.amount_kobo
        else 1 end as cash_ratio,
        case when p.amount_kobo > 0 then
          (coalesce(pc.promo_kobo, 0)
           + (case when v.kind = 'reward_discount' then p.voucher_covered_kobo else 0 end)
          )::numeric / p.amount_kobo
        else 0 end as promo_ratio
      from public.service_purchases p
      left join public.care_vouchers v on v.id = p.applied_voucher_id
      left join (
        select service_purchase_id, sum(paid_amount_kobo) as paid_kobo, sum(promo_amount_kobo) as promo_kobo
        from public.platform_credit_ledger_entries
        where entry_type = 'spend'
        group by service_purchase_id
      ) pc on pc.service_purchase_id = p.id
      where p.id = s.source_id
    ) f on s.source_kind = 'service_purchase'
  )
  select coalesce(sum(cash_amt), 0), coalesce(sum(promo_amt), 0)
  into v_recog_cash, v_recog_promo
  from funded;

  v_cash := v_cash + v_recog_cash;
  v_promo := v_promo + v_recog_promo;

  return jsonb_build_object(
    'currency', p_currency,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'cash_minor', v_cash,
    'promotional_minor', v_promo,
    'unclassified_minor', v_unclassified,
    'total_minor', v_cash + v_promo + v_unclassified
  );
end;
$$;

revoke all on function public.finance_revenue_by_funding_source(date, date, text) from public, anon;
grant execute on function public.finance_revenue_by_funding_source(date, date, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.finance_revenue_by_funding_source(date, date, text)', 'EXECUTE') then
    raise exception 'anon can execute finance_revenue_by_funding_source';
  end if;
end $$;
