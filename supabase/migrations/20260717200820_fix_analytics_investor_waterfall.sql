-- Fix: window function (lag) can't be nested inside jsonb_agg — precompute the
-- per-month waterfall (incl. lag for "starting") in a CTE, then aggregate.
create or replace function public.analytics_investor_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_mrr bigint; v_active int; v_prior_mrr bigint; v_growth numeric;
  v_churned_30 int; v_base int; v_rev_churn numeric; v_arpa numeric;
  fi public.platform_finance_inputs%rowtype;
  v_ltv numeric; v_cac numeric; v_payback numeric; v_new_cust int; v_margin numeric;
  v_net_burn numeric; v_runway numeric; v_rule40 numeric;
  v_cur_month date := date_trunc('month', now())::date;
  v_prior_month date := (date_trunc('month', now()) - interval '1 month')::date;
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;

  select coalesce(sum(mrr_minor),0) into v_mrr from public.mrr_snapshots where snapshot_month = v_cur_month;
  if v_mrr = 0 then
    select coalesce(sum(case when interval='yearly' then coalesce(amount_minor,0)/12 else coalesce(amount_minor,0) end),0)
      into v_mrr from public.subscriptions where status in ('active','trialing') and currency='NGN';
  end if;
  select count(*) into v_active from public.subscriptions where status in ('active','trialing');
  select coalesce(sum(mrr_minor),0) into v_prior_mrr from public.mrr_snapshots where snapshot_month = v_prior_month;
  v_growth := case when v_prior_mrr = 0 then 0 else round(100.0*(v_mrr - v_prior_mrr)/v_prior_mrr,1) end;

  select count(*) into v_churned_30 from public.subscriptions where status='cancelled' and cancelled_at >= now() - interval '30 days';
  v_base := v_active + v_churned_30;
  v_rev_churn := case when v_base = 0 then 0 else round(100.0 * v_churned_30 / v_base, 1) end;
  v_arpa := case when v_active = 0 then 0 else round(v_mrr::numeric / v_active, 0) end;

  select * into fi from public.platform_finance_inputs where currency='NGN' order by period_month desc limit 1;
  v_margin := coalesce(fi.gross_margin_pct, 0);
  select count(*) into v_new_cust from public.subscriptions where status in ('active','trialing') and started_at >= v_cur_month;
  if fi.new_customers is not null then v_new_cust := fi.new_customers; end if;

  v_ltv := case when v_rev_churn <= 0 then null else round(v_arpa * (v_margin/100.0) / (v_rev_churn/100.0), 0) end;
  v_cac := case when coalesce(fi.marketing_spend_minor,0) = 0 or v_new_cust = 0 then null else round(fi.marketing_spend_minor::numeric / v_new_cust, 0) end;
  v_payback := case when v_arpa*(v_margin/100.0) <= 0 or v_cac is null then null else round(v_cac / (v_arpa*(v_margin/100.0)), 1) end;
  v_net_burn := coalesce(fi.operating_expense_minor,0) + coalesce(fi.marketing_spend_minor,0) - v_mrr;
  v_runway := case when fi.id is null or v_net_burn <= 0 then null else round(coalesce(fi.cash_balance_minor,0)::numeric / v_net_burn, 1) end;
  v_rule40 := v_growth + v_margin;

  return jsonb_build_object(
    'mrr_minor', v_mrr,
    'arr_minor', v_mrr * 12,
    'active_subscriptions', v_active,
    'mom_growth_pct', v_growth,
    'arpa_minor', v_arpa,
    'logo_churn_pct', case when v_base=0 then 0 else round(100.0*v_churned_30/v_base,1) end,
    'revenue_churn_pct', v_rev_churn,
    'mrr_waterfall', (
      with totals as (select snapshot_month, sum(mrr_minor) ending from public.mrr_snapshots group by snapshot_month),
      wf as (
        select t.snapshot_month,
          coalesce(lag(t.ending) over (order by t.snapshot_month),0) starting,
          t.ending,
          (select coalesce(sum(mrr_minor),0) from public.mrr_snapshots cur where cur.snapshot_month=t.snapshot_month
            and not exists (select 1 from public.mrr_snapshots pr where pr.subscriber_id=cur.subscriber_id and pr.snapshot_month = t.snapshot_month - interval '1 month')) new_mrr,
          -(select coalesce(sum(mrr_minor),0) from public.mrr_snapshots pr where pr.snapshot_month = t.snapshot_month - interval '1 month'
            and not exists (select 1 from public.mrr_snapshots cur where cur.subscriber_id=pr.subscriber_id and cur.snapshot_month=t.snapshot_month)) churned_mrr
        from totals t
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(snapshot_month,'YYYY-MM'), 'starting', starting,
        'new_mrr', new_mrr, 'churned_mrr', churned_mrr, 'ending', ending) order by snapshot_month), '[]'::jsonb)
      from wf
    ),
    'nrr_pct', (
      select case when coalesce(sum(p.mrr_minor),0)=0 then null else
        round(100.0 * coalesce(sum(c.mrr_minor),0) / sum(p.mrr_minor), 1) end
      from public.mrr_snapshots p
      left join public.mrr_snapshots c on c.subscriber_id=p.subscriber_id and c.snapshot_month=v_cur_month
      where p.snapshot_month=v_prior_month
    ),
    'grr_pct', (
      select case when coalesce(sum(p.mrr_minor),0)=0 then null else
        round(100.0 * coalesce(sum(least(c.mrr_minor, p.mrr_minor)),0) / sum(p.mrr_minor), 1) end
      from public.mrr_snapshots p
      left join public.mrr_snapshots c on c.subscriber_id=p.subscriber_id and c.snapshot_month=v_cur_month
      where p.snapshot_month=v_prior_month
    ),
    'concentration', (
      select coalesce(jsonb_agg(jsonb_build_object('plan', name, 'mrr_minor', mrr, 'pct',
        case when v_mrr=0 then 0 else round(100.0*mrr/v_mrr,1) end) order by mrr desc), '[]'::jsonb)
      from (select pl.name, sum(case when s.interval='yearly' then coalesce(s.amount_minor,0)/12 else coalesce(s.amount_minor,0) end) mrr
            from public.subscriptions s join public.subscription_plans pl on pl.id=s.plan_id
            where s.status in ('active','trialing') and s.currency='NGN' group by pl.name) t
    ),
    'unit_economics', jsonb_build_object(
      'inputs_present', fi.id is not null,
      'gross_margin_pct', v_margin,
      'ltv_minor', v_ltv, 'cac_minor', v_cac,
      'ltv_cac_ratio', case when v_cac is null or v_cac=0 or v_ltv is null then null else round(v_ltv/v_cac,1) end,
      'cac_payback_months', v_payback,
      'rule_of_40', v_rule40,
      'net_burn_minor', v_net_burn,
      'runway_months', v_runway,
      'new_customers', v_new_cust
    )
  );
end; $$;
