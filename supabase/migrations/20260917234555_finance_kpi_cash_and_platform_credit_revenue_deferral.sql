-- Finance dashboard audit (2026-09-18): two real bugs found by comparing the
-- KPI tile RPC against the dashboard summary RPC, and by comparing a platform
-- credit-funded purchase's journal entries against the same product bought by
-- card.
--
-- 1) finance_kpi_summary's cash figure (used for cash_runway_months) summed
--    only accounts 1000/1010, omitting 1020 "Payment processor clearing" —
--    the account that actually holds the bulk of live cash today (every
--    platform-credit top-up and most card payments land there first).
--    finance_dashboard_summary's own cash_ngn tile already includes 1020
--    correctly; the KPI RPC was the odd one out. Live effect: cash was
--    genuinely ~₦20,355 but the KPI tile showed "Cash runway: 0 mo" because
--    its own cash figure came back ₦0.
--
-- 2) private.finance_post_platform_credit_ledger_entry's 'spend' branch always
--    credited revenue (4100) immediately, with no check for whether the
--    purchased service has a bounded access window. The equivalent card-
--    payment path (private.finance_post_from_payment, service_purchase
--    branch) correctly defers to 2000 and creates a
--    revenue_recognition_schedule when service_products.access_duration_days
--    is set. Live effect: the same "Continuous Monitoring, 3 months" product
--    was booked to deferred revenue when paid by card (entry #268) but
--    recognised as revenue on day one when paid by platform credit
--    (entry #290) — a real matching-principle violation, and inconsistent
--    with this platform's own stated policy ("a service bought up front is
--    deferred until it is delivered", CLAUDE.md and the Finance overview
--    page's own banner).

create or replace function public.finance_kpi_summary(p_currency text default 'NGN'::text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_cur public.currency := coalesce(p_currency,'NGN')::public.currency;
  v_today date := current_date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_last_month_start date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_last_month_end date := v_month_start - 1;
  v_year_ago_month_start date := (date_trunc('month', v_today) - interval '1 year')::date;
  v_year_ago_month_end date := (v_year_ago_month_start + interval '1 month' - interval '1 day')::date;
  v_revenue_mtd bigint;
  v_revenue_last_month bigint;
  v_revenue_year_ago_month bigint;
  v_expense_mtd bigint;
  v_direct_costs_mtd bigint;
  v_cash bigint;
  v_receivable bigint;
  v_revenue_90d bigint;
  v_expense_3mo_avg numeric;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;

  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_revenue_mtd
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=v_cur and e.entry_date>=v_month_start and e.entry_date<=v_today;

  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_revenue_last_month
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=v_cur and e.entry_date>=v_last_month_start and e.entry_date<=v_last_month_end;

  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_revenue_year_ago_month
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=v_cur and e.entry_date>=v_year_ago_month_start and e.entry_date<=v_year_ago_month_end;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_expense_mtd
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='expense' and l.currency=v_cur and e.entry_date>=v_month_start and e.entry_date<=v_today;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_direct_costs_mtd
    from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
    where l.account_code='5000' and l.currency=v_cur and e.entry_date>=v_month_start and e.entry_date<=v_today;

  -- Fix (1): include 1020 "Payment processor clearing", matching
  -- finance_dashboard_summary's cash_ngn tile.
  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_cash
    from public.finance_journal_lines l where l.account_code in ('1000','1010','1020') and l.currency=v_cur;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_receivable
    from public.finance_journal_lines l where l.account_code='1200' and l.currency=v_cur;

  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_revenue_90d
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=v_cur and e.entry_date >= v_today - 90;

  select coalesce(sum(l.debit_minor-l.credit_minor),0)/3.0 into v_expense_3mo_avg
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='expense' and l.currency=v_cur and e.entry_date >= v_today - 90;

  return jsonb_build_object(
    'currency', p_currency,
    'revenue_mtd_minor', v_revenue_mtd,
    'gross_profit_mtd_minor', v_revenue_mtd - v_direct_costs_mtd,
    'gross_margin_pct', case when v_revenue_mtd > 0 then round(((v_revenue_mtd - v_direct_costs_mtd)::numeric / v_revenue_mtd) * 100, 1) else null end,
    'net_income_mtd_minor', v_revenue_mtd - v_expense_mtd,
    'net_margin_pct', case when v_revenue_mtd > 0 then round(((v_revenue_mtd - v_expense_mtd)::numeric / v_revenue_mtd) * 100, 1) else null end,
    'mom_revenue_growth_pct', case when v_revenue_last_month > 0 then round(((v_revenue_mtd - v_revenue_last_month)::numeric / v_revenue_last_month) * 100, 1) else null end,
    'yoy_revenue_growth_pct', case when v_revenue_year_ago_month > 0 then round(((v_revenue_mtd - v_revenue_year_ago_month)::numeric / v_revenue_year_ago_month) * 100, 1) else null end,
    'dso_days', case when v_revenue_90d > 0 then round((v_receivable::numeric / (v_revenue_90d::numeric/90)), 1) else null end,
    'cash_runway_months', case when v_expense_3mo_avg > 0 then round((v_cash::numeric / v_expense_3mo_avg), 1) else null end,
    'cash_minor', v_cash,
    'receivable_minor', v_receivable
  );
end; $function$;

create or replace function private.finance_post_platform_credit_ledger_entry()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_access_duration_days int;
  v_pstart date;
  v_pend date;
  v_total_kobo bigint;
  v_revenue_account text;
begin
  if new.entry_type = 'topup' then
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'platform_credit', 'topup:' || new.id::text,
      'Platform credit top-up',
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','2100','debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
      null);

  elsif new.entry_type = 'admin_grant' then
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'platform_credit', 'grant:' || new.id::text,
      coalesce('Platform credit granted — ' || new.description, 'Platform credit granted'),
      jsonb_build_array(
        jsonb_build_object('account_code','6000','debit_minor',new.promo_amount_kobo,'credit_minor',0,
                           'organisation_id',new.organisation_id,'cost_center_code','MARKETING'),
        jsonb_build_object('account_code','2600','debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
      null);

  elsif new.entry_type = 'spend' then
    -- Fix (2): a spend that funds a bounded-access-window service_purchase
    -- must defer to 2000 and recognise over the window, exactly like the
    -- same product bought by card (private.finance_post_from_payment) —
    -- never straight to 4100 regardless of what was actually purchased.
    v_access_duration_days := null;
    if new.service_purchase_id is not null then
      select sp.access_duration_days into v_access_duration_days
      from public.service_purchases p
      join public.service_products sp on sp.id = p.service_product_id
      where p.id = new.service_purchase_id;
    end if;
    v_revenue_account := case when v_access_duration_days is not null then '2000' else '4100' end;

    -- Discharge whichever liability actually funded this spend — one line
    -- pair per bucket touched, both crediting the same destination account,
    -- so the split between "real money finally earned" and "promotional
    -- cost finally redeemed" survives all the way into the GL.
    if new.paid_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'spend-paid:' || new.id::text,
        'Platform credit spent (customer funds) — ' || coalesce(new.description, 'service purchase'),
        jsonb_build_array(
          jsonb_build_object('account_code','2100','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code',v_revenue_account,'debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
    if new.promo_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'spend-promo:' || new.id::text,
        'Platform credit spent (promotional) — ' || coalesce(new.description, 'service purchase'),
        jsonb_build_array(
          jsonb_build_object('account_code','2600','debit_minor',new.promo_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code',v_revenue_account,'debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;

    if v_access_duration_days is not null then
      v_total_kobo := coalesce(new.paid_amount_kobo,0) + coalesce(new.promo_amount_kobo,0);
      v_pstart := current_date;
      v_pend := (v_pstart + (v_access_duration_days || ' days')::interval)::date;
      if v_total_kobo > 0 and v_pend > v_pstart then
        perform private.finance_create_recognition_schedule(
          'service_purchase', new.service_purchase_id, null, new.organisation_id,
          '4020', 'NGN'::public.currency, v_total_kobo, v_pstart, v_pend);
      end if;
    end if;

  elsif new.entry_type = 'admin_correction' then
    -- Rare and manual by design — post to Refunds payable (2400) as a flag
    -- for finance to settle out of band, rather than guessing whether real
    -- cash actually needs to move. See this migration set's ledger-functions
    -- file for what triggers a correction.
    if new.paid_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'correction-paid:' || new.id::text,
        'Platform credit correction (paid) — ' || coalesce(new.description, 'manual adjustment'),
        jsonb_build_array(
          jsonb_build_object('account_code','2100','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
    if new.promo_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'correction-promo:' || new.id::text,
        'Platform credit correction (promo) — ' || coalesce(new.description, 'manual adjustment'),
        jsonb_build_array(
          jsonb_build_object('account_code','2600','debit_minor',new.promo_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
  end if;

  return new;
exception when others then
  return new; -- accounting must never block a patient's top-up or spend
end;
$function$;
