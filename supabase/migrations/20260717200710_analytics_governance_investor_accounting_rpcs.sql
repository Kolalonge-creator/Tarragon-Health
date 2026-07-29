-- Tarragon Health — Analytics Console: governance, investor, accounting RPCs.
-- security definer, search_path='', gated by private.is_analyst(), authenticated.
-- NOTE: analytics_investor_summary() below has a bug in its mrr_waterfall block
-- (a window function nested inside jsonb_agg) that is corrected by the very next
-- migration, 20260717200820_fix_analytics_investor_waterfall.sql — kept here to
-- match the applied remote history exactly.

-- ===========================================================================
-- GOVERNANCE & COMPLIANCE
-- ===========================================================================
create or replace function public.analytics_governance_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'clinical', jsonb_build_object(
      'staff_total', (select count(*) from public.clinical_staff),
      'staff_verified', (select count(*) from public.clinical_staff where license_verified_at is not null),
      'staff_unverified_active', (select count(*) from public.clinical_staff where active and license_verified_at is null),
      'verification_pct', (select case when count(*)=0 then 0 else round(100.0*count(*) filter (where license_verified_at is not null)/count(*),1) end from public.clinical_staff),
      'tier_unassigned', (select count(*) from public.clinical_staff where active and doctor_tier is null),
      'indemnity_covered', (select count(*) from public.clinical_staff where indemnity_expires_at >= now()),
      'indemnity_expiring_30d', (select count(*) from public.clinical_staff where indemnity_expires_at >= now() and indemnity_expires_at < now() + interval '30 days'),
      'indemnity_expired', (select count(*) from public.clinical_staff where indemnity_expires_at is not null and indemnity_expires_at < now()),
      'indemnity_exempt', (select count(*) from public.clinical_staff where indemnity_exempt),
      'protocols_total', (select count(distinct protocol_id) from public.protocol_versions),
      'protocols_signed', (select count(*) from public.protocol_versions where approved_at is not null)
    ),
    'privacy', jsonb_build_object(
      'patients_total', (select count(*) from public.profiles where role='patient'),
      'kyc_verified', (select count(distinct patient_id) from public.identity_verifications where status='verified'),
      'kyc_pending', (select count(distinct patient_id) from public.identity_verifications where status='pending'),
      'consent_coverage', (
        select coalesce(jsonb_agg(jsonb_build_object('consent_type', consent_type, 'accepted', accepted, 'total', total,
          'pct', case when total=0 then 0 else round(100.0*accepted/total,1) end) order by consent_type), '[]'::jsonb)
        from (
          select cv.consent_type::text consent_type, count(distinct pc.patient_id) accepted,
            (select count(*) from public.profiles where role='patient') total
          from public.consent_versions cv
          left join public.patient_consents pc on pc.consent_version_id = cv.id
          where cv.is_current
          group by cv.consent_type, cv.id
        ) t
      )
    ),
    'security', jsonb_build_object(
      'audit_events_30d', (select count(*) from public.audit_log where created_at >= now() - interval '30 days'),
      'admin_accounts', (select count(*) from public.profiles where role='admin'),
      'analyst_accounts', (select count(*) from public.profiles where role='analyst')
    ),
    'risk', jsonb_build_object(
      'open', (select count(*) from public.risk_register where status <> 'closed'),
      'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
        from (select status, count(*) c from public.risk_register group by status) t),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'count', c) order by c desc), '[]'::jsonb)
        from (select category, count(*) c from public.risk_register group by category) t)
    )
  );
end; $$;

create or replace function public.analytics_risk_register()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'category', category, 'likelihood', likelihood,
      'impact', impact, 'status', status, 'owner', owner, 'mitigation', mitigation,
      'updated_at', updated_at) order by (case status when 'open' then 0 when 'mitigating' then 1 else 2 end), updated_at desc)
    from public.risk_register
  ), '[]'::jsonb);
end; $$;

create or replace function public.analytics_upsert_risk(
  p_id uuid, p_title text, p_category text, p_likelihood text, p_impact text,
  p_status text, p_owner text, p_mitigation text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_analyst() then raise exception 'not authorised'; end if;
  if p_id is null then
    insert into public.risk_register (title, category, likelihood, impact, status, owner, mitigation)
    values (p_title, coalesce(p_category,'operational'), coalesce(p_likelihood,'medium'), coalesce(p_impact,'medium'),
            coalesce(p_status,'open'), p_owner, p_mitigation)
    returning id into v_id;
  else
    update public.risk_register set title=p_title, category=coalesce(p_category,'operational'),
      likelihood=coalesce(p_likelihood,'medium'), impact=coalesce(p_impact,'medium'),
      status=coalesce(p_status,'open'), owner=p_owner, mitigation=p_mitigation, updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  return v_id;
end; $$;

-- ===========================================================================
-- INVESTOR / BOARD  (amounts minor; several figures modeled — labelled in UI)
-- ===========================================================================
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
      with months as (select distinct snapshot_month from public.mrr_snapshots order by snapshot_month),
      totals as (select snapshot_month, sum(mrr_minor) ending from public.mrr_snapshots group by snapshot_month)
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(m.snapshot_month,'YYYY-MM'),
        'starting', coalesce(lag(t.ending) over (order by m.snapshot_month),0),
        'new_mrr', (select coalesce(sum(mrr_minor),0) from public.mrr_snapshots cur where cur.snapshot_month=m.snapshot_month
                    and not exists (select 1 from public.mrr_snapshots pr where pr.subscriber_id=cur.subscriber_id and pr.snapshot_month = m.snapshot_month - interval '1 month')),
        'churned_mrr', -(select coalesce(sum(mrr_minor),0) from public.mrr_snapshots pr where pr.snapshot_month = m.snapshot_month - interval '1 month'
                    and not exists (select 1 from public.mrr_snapshots cur where cur.subscriber_id=pr.subscriber_id and cur.snapshot_month=m.snapshot_month)),
        'ending', t.ending) order by m.snapshot_month), '[]'::jsonb)
      from months m join totals t on t.snapshot_month=m.snapshot_month
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

create or replace function public.analytics_finance_inputs()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'period_month', to_char(period_month,'YYYY-MM'), 'currency', currency,
      'marketing_spend_minor', marketing_spend_minor, 'operating_expense_minor', operating_expense_minor,
      'cash_balance_minor', cash_balance_minor, 'gross_margin_pct', gross_margin_pct,
      'new_customers', new_customers, 'notes', notes) order by period_month desc)
    from public.platform_finance_inputs
  ), '[]'::jsonb);
end; $$;

create or replace function public.analytics_upsert_finance_input(
  p_month date, p_currency text, p_marketing bigint, p_opex bigint, p_cash bigint,
  p_margin numeric, p_new_customers integer, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_analyst() then raise exception 'not authorised'; end if;
  insert into public.platform_finance_inputs
    (period_month, currency, marketing_spend_minor, operating_expense_minor, cash_balance_minor, gross_margin_pct, new_customers, notes, updated_by)
  values (date_trunc('month', p_month)::date, coalesce(p_currency,'NGN')::public.currency,
          coalesce(p_marketing,0), coalesce(p_opex,0), coalesce(p_cash,0), coalesce(p_margin,0), p_new_customers, p_notes, (select auth.uid()))
  on conflict (period_month, currency) do update set
    marketing_spend_minor=excluded.marketing_spend_minor, operating_expense_minor=excluded.operating_expense_minor,
    cash_balance_minor=excluded.cash_balance_minor, gross_margin_pct=excluded.gross_margin_pct,
    new_customers=excluded.new_customers, notes=excluded.notes, updated_at=now(), updated_by=excluded.updated_by;
end; $$;

-- ===========================================================================
-- ACCOUNTING / REVENUE  (revenue recognition modeled from subscription periods)
-- ===========================================================================
create or replace function public.analytics_accounting_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'revenue_recognition', (
      with periods as (
        select s.currency::text currency,
          coalesce(s.amount_minor,0) amount,
          (case when s.interval='yearly' then s.current_period_end - interval '1 year' else s.current_period_end - interval '1 month' end) period_start,
          s.current_period_end period_end
        from public.subscriptions s
        where s.status in ('active','trialing') and s.current_period_end is not null and s.amount_minor is not null
      ),
      calc as (
        select currency, amount,
          case when period_end <= period_start then amount
               else round(amount * (extract(epoch from (least(now(), period_end) - period_start)) /
                    nullif(extract(epoch from (period_end - period_start)),0)))::bigint end recognized
        from periods where period_end > period_start
      )
      select jsonb_build_object(
        'billed_minor', coalesce(sum(amount),0),
        'recognized_minor', coalesce(sum(least(recognized, amount)),0),
        'deferred_minor', coalesce(sum(amount - least(recognized, amount)),0),
        'by_currency', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'billed', b, 'recognized', r, 'deferred', d) order by b desc),'[]'::jsonb)
          from (select currency, sum(amount) b, sum(least(recognized,amount)) r, sum(amount-least(recognized,amount)) d from calc group by currency) x)
      ) from calc
    ),
    'ar_aging', jsonb_build_object(
      'subscriptions_past_due', (select count(*) from public.subscriptions where status='past_due'),
      'commission_receivable_kobo', (select coalesce(sum(amount_kobo),0) from public.commissions where status in ('pending','confirmed')),
      'aging', (select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'kobo', kobo) order by ord), '[]'::jsonb)
        from (
          select bucket, ord, coalesce(sum(amount_kobo),0) kobo from (
            select amount_kobo,
              case when earned_at >= now() - interval '30 days' then '0-30 days'
                   when earned_at >= now() - interval '60 days' then '31-60 days'
                   when earned_at >= now() - interval '90 days' then '61-90 days'
                   else '90+ days' end bucket,
              case when earned_at >= now() - interval '30 days' then 1
                   when earned_at >= now() - interval '60 days' then 2
                   when earned_at >= now() - interval '90 days' then 3 else 4 end ord
            from public.commissions where status in ('pending','confirmed')
          ) a group by bucket, ord
        ) t)
    ),
    'reconciliation', (
      select jsonb_build_object(
        'payments_collected', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'total_minor', total) order by total desc),'[]'::jsonb)
          from (select currency::text currency, sum(coalesce(amount_minor,0)) total from public.payment_transactions group by currency) x),
        'refunds_minor', (select coalesce(sum(coalesce(amount_minor,0)),0) from public.payment_transactions where event_type::text ilike '%refund%')
      )
    )
  );
end; $$;

do $$
declare fn text; fns text[] := array[
  'public.analytics_governance_summary()',
  'public.analytics_risk_register()',
  'public.analytics_upsert_risk(uuid, text, text, text, text, text, text, text)',
  'public.analytics_investor_summary()',
  'public.analytics_finance_inputs()',
  'public.analytics_upsert_finance_input(date, text, bigint, bigint, bigint, numeric, integer, text)',
  'public.analytics_accounting_summary()'
];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end; $$;
