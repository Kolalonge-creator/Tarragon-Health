-- The Investor analytics page's "Net burn / mo" tile is the one unit-economics
-- figure that did not follow the file's own documented rule (see
-- apps/web/src/app/(dashboard)/analytics/_components/investor-dashboard.tsx's
-- top-of-file comment): CAC and Runway already return null (rendered as "—")
-- when no platform_finance_inputs row exists yet, but net_burn_minor computed
-- coalesce(opex,0) + coalesce(ad_spend,0) - revenue_30d unconditionally, so with
-- no finance inputs at all it silently showed "-revenue_30d" as a confident
-- negative "burn" figure instead of the honest "no finance inputs yet" absence.
-- Found 2026-09-18 auditing the analyst role's /analytics/investor page: with
-- zero finance inputs entered it displayed "Net burn / mo: ₦-17,500" (the
-- negative of the period's real revenue) rather than "—".
create or replace function public.analytics_investor_summary()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_rev_30 bigint; v_rev_prior_30 bigint; v_rev_90 bigint; v_rev_12m bigint;
  v_growth numeric; v_paying int; v_repeat int; v_arppu numeric;
  fi public.platform_finance_inputs%rowtype;
  v_cac numeric; v_new_cust int; v_margin numeric;
  v_net_burn numeric; v_runway numeric; v_rule40 numeric;
  v_cur_month date := date_trunc('month', now())::date;
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;

  select
    coalesce(sum(amount) filter (where at >= now() - interval '30 days'), 0),
    coalesce(sum(amount) filter (where at >= now() - interval '60 days' and at < now() - interval '30 days'), 0),
    coalesce(sum(amount) filter (where at >= now() - interval '90 days'), 0),
    coalesce(sum(amount) filter (where at >= now() - interval '12 months'), 0)
  into v_rev_30, v_rev_prior_30, v_rev_90, v_rev_12m
  from (
    select coalesce(sp.purchased_at, sp.created_at) at,
           coalesce(sp.payable_kobo, sp.amount_kobo) amount
    from public.service_purchases sp where sp.status in ('active','expired')
    union all
    select coalesce(pp.purchased_at, pp.created_at), pp.price_kobo
    from public.programme_purchases pp where pp.status in ('active','completed','expired')
  ) r;

  v_growth := case when v_rev_prior_30 = 0 then 0
                   else round(100.0 * (v_rev_30 - v_rev_prior_30) / v_rev_prior_30, 1) end;

  select count(*), count(*) filter (where n > 1) into v_paying, v_repeat
  from (
    select patient_id, count(*) n from (
      select patient_id from public.service_purchases where status in ('active','expired')
      union all
      select patient_id from public.programme_purchases where status in ('active','completed','expired')
    ) x group by patient_id
  ) t;

  v_arppu := case when v_paying = 0 then 0 else round(v_rev_12m::numeric / v_paying) end;

  select * into fi from public.platform_finance_inputs where currency='NGN' order by period_month desc limit 1;
  v_margin := coalesce(fi.gross_margin_pct, 0);

  select count(*) into v_new_cust from (
    select patient_id from public.service_purchases
      where status in ('active','expired') and purchased_at >= v_cur_month
    union
    select patient_id from public.programme_purchases
      where status in ('active','completed','expired') and purchased_at >= v_cur_month
  ) t;
  if fi.new_customers is not null then v_new_cust := fi.new_customers; end if;

  v_cac := case when coalesce(fi.marketing_spend_minor,0) = 0 or v_new_cust = 0 then null
                else round(fi.marketing_spend_minor::numeric / v_new_cust, 0) end;
  -- Fixed: null (not a computed negative) until a finance-inputs row exists.
  v_net_burn := case when fi.id is null then null
                     else coalesce(fi.operating_expense_minor,0) + coalesce(fi.marketing_spend_minor,0) - v_rev_30 end;
  v_runway := case when fi.id is null or v_net_burn <= 0 then null
                   else round(coalesce(fi.cash_balance_minor,0)::numeric / v_net_burn, 1) end;
  v_rule40 := v_growth + v_margin;

  return jsonb_build_object(
    'revenue_30d_minor', v_rev_30,
    'revenue_90d_minor', v_rev_90,
    'revenue_12m_minor', v_rev_12m,
    'mom_growth_pct', v_growth,
    'paying_patients', v_paying,
    'repeat_rate_pct', case when v_paying = 0 then 0 else round(100.0 * v_repeat / v_paying, 1) end,
    'arppu_minor', v_arppu,
    'revenue_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(bucket,'YYYY-MM'),
        'revenue_minor', revenue,
        'purchases', purchases,
        'paying_patients', patients) order by bucket), '[]'::jsonb)
      from (
        select date_trunc('month', at) bucket, sum(amount)::bigint revenue,
               count(*) purchases, count(distinct patient_id) patients
        from (
          select coalesce(sp.purchased_at, sp.created_at) at, sp.patient_id,
                 coalesce(sp.payable_kobo, sp.amount_kobo) amount
          from public.service_purchases sp where sp.status in ('active','expired')
          union all
          select coalesce(pp.purchased_at, pp.created_at), pp.patient_id, pp.price_kobo
          from public.programme_purchases pp where pp.status in ('active','completed','expired')
        ) r group by 1
      ) m
    ),
    'concentration', (
      select coalesce(jsonb_agg(jsonb_build_object('product', name, 'revenue_minor', rev, 'pct',
        case when v_rev_12m = 0 then 0 else round(100.0 * rev / v_rev_12m, 1) end) order by rev desc), '[]'::jsonb)
      from (
        select p.name, sum(coalesce(sp.payable_kobo, sp.amount_kobo))::bigint rev
        from public.service_purchases sp
        join public.service_products p on p.id = sp.service_product_id
        where sp.status in ('active','expired')
          and coalesce(sp.purchased_at, sp.created_at) >= now() - interval '12 months'
        group by p.name
        union all
        select '12-Week Doctor-Supported Programme', sum(pp.price_kobo)::bigint
        from public.programme_purchases pp
        where pp.status in ('active','completed','expired')
          and coalesce(pp.purchased_at, pp.created_at) >= now() - interval '12 months'
        having count(*) > 0
      ) t
    ),
    'unit_economics', jsonb_build_object(
      'inputs_present', fi.id is not null,
      'gross_margin_pct', v_margin,
      'cac_minor', v_cac,
      'rule_of_40', v_rule40,
      'net_burn_minor', v_net_burn,
      'runway_months', v_runway,
      'new_customers', v_new_cust
    )
  );
end;
$function$;

do $$
declare
  v_no_inputs jsonb;
begin
  -- With no platform_finance_inputs row at all (the live, current state),
  -- net_burn_minor must now be null, matching cac_minor/runway_months.
  if exists (select 1 from public.platform_finance_inputs) then
    raise notice 'platform_finance_inputs is non-empty; skipping the no-inputs proof (nothing to simulate against in this environment).';
  else
    v_no_inputs := public.analytics_investor_summary();
    if (v_no_inputs -> 'unit_economics' ->> 'net_burn_minor') is not null then
      raise exception 'net_burn_minor should be null with zero finance-inputs rows, got %',
        v_no_inputs -> 'unit_economics' ->> 'net_burn_minor';
    end if;
  end if;
end $$;
