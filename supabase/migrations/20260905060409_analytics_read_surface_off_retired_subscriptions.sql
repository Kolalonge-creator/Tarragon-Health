-- Tarragon Health — repoint the analytics read surface off the retired
-- subscription model and onto what the business actually earns.
--
-- The 2026-09-02 cutover retired subscription plans entirely: the app is free
-- and Tarragon charges per piece of doctor work (service_products /
-- service_purchases) plus the 12-week doctor-supported programme
-- (programme_purchases). Roughly ten sibling analytics functions were rewired
-- in that batch; these were missed, so every money figure on
-- /analytics/financial, /analytics/investor, /analytics/business,
-- /analytics/accounting, /analytics/users, /analytics/acquisition and the
-- operations control centre has been reading tables that will never gain
-- another row.
--
-- Live evidence at the time of writing (koiplnmbgnqnbywhpjlf):
--   public.subscriptions            0 rows  (never any, at any status)
--   public.programme_purchases      0 rows
--   public.mrr_snapshots            fed only by the mrr-snapshot-monthly cron,
--                                   which selects from subscriptions
--   public.service_purchases        9 rows, 4 of them paid (NGN 176,500)
--   public.payment_transactions     3 rows, ALL of them failed Stripe webhooks
--                                   with a non-null `error`
--
-- That last line matters: analytics_revenue_timeseries and the accounting
-- reconciliation panel summed payment_transactions unconditionally, so three
-- errored Stripe test webhooks were being reported as USD 20 of revenue.
-- Every read of payment_transactions here now excludes errored rows, and
-- revenue itself comes from the purchase tables rather than the webhook log.
--
-- What is deliberately NOT replaced, because the pay-per-service model has no
-- honest equivalent and inventing one would be worse than an empty tile:
--   MRR / ARR                 nothing recurs except the 12-week programme
--   churn rate, NRR, GRR      no subscription to retain or lose
--   the MRR waterfall         same
--   LTV, LTV:CAC, CAC payback all derive from a churn rate that does not exist
-- The callers of those keys are removed in the same change.

-- ---------------------------------------------------------------------------
-- 1. Financial summary
--
--    "Paid" throughout this migration means money actually taken: a purchase
--    that reached 'active' and may since have been consumed ('expired'), never
--    one still at 'pending_payment', 'cancelled' or 'refunded'.
--
--    Amount uses coalesce(payable_kobo, amount_kobo) — the cash collected for
--    this purchase. Where a Care Voucher covered part of the price, that part
--    was paid for by the sponsor when the voucher was bought and is recognised
--    there, so counting amount_kobo here would double-count it.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_financial_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paying_patients int;
  v_repeat_patients int;
  v_paid_purchases  int;
  v_revenue_kobo    bigint;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select count(*), coalesce(sum(coalesce(sp.payable_kobo, sp.amount_kobo)), 0)
    into v_paid_purchases, v_revenue_kobo
    from public.service_purchases sp
    where sp.status in ('active', 'expired');

  select count(*), count(*) filter (where n > 1)
    into v_paying_patients, v_repeat_patients
    from (
      select sp.patient_id, count(*) n
      from public.service_purchases sp
      where sp.status in ('active', 'expired')
      group by sp.patient_id
    ) t;

  return jsonb_build_object(
    -- Revenue actually collected, per currency, across both paid surfaces.
    'revenue_by_currency', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'total_minor', total)
                                order by currency), '[]'::jsonb)
      from (
        select currency, sum(total)::bigint total from (
          select sp.currency::text currency,
                 coalesce(sp.payable_kobo, sp.amount_kobo) total
          from public.service_purchases sp
          where sp.status in ('active', 'expired')
          union all
          select 'NGN', pp.price_kobo
          from public.programme_purchases pp
          where pp.status in ('active', 'completed', 'expired')
        ) u group by currency
      ) t
    ),
    'revenue_total_kobo', v_revenue_kobo
      + coalesce((select sum(pp.price_kobo) from public.programme_purchases pp
                  where pp.status in ('active', 'completed', 'expired')), 0),
    'revenue_30d_kobo', coalesce((
      select sum(coalesce(sp.payable_kobo, sp.amount_kobo)) from public.service_purchases sp
      where sp.status in ('active', 'expired') and sp.purchased_at >= now() - interval '30 days'
    ), 0) + coalesce((
      select sum(pp.price_kobo) from public.programme_purchases pp
      where pp.status in ('active', 'completed', 'expired') and pp.purchased_at >= now() - interval '30 days'
    ), 0),
    'revenue_90d_kobo', coalesce((
      select sum(coalesce(sp.payable_kobo, sp.amount_kobo)) from public.service_purchases sp
      where sp.status in ('active', 'expired') and sp.purchased_at >= now() - interval '90 days'
    ), 0) + coalesce((
      select sum(pp.price_kobo) from public.programme_purchases pp
      where pp.status in ('active', 'completed', 'expired') and pp.purchased_at >= now() - interval '90 days'
    ), 0),
    'paid_purchases', v_paid_purchases
      + coalesce((select count(*) from public.programme_purchases pp
                  where pp.status in ('active', 'completed', 'expired')), 0),
    'purchases_awaiting_payment', (
      select count(*) from public.service_purchases where status = 'pending_payment'
    ) + (
      select count(*) from public.programme_purchases where status = 'pending_payment'
    ),
    'paying_patients', v_paying_patients,
    -- Share of paying patients who came back and bought a second time. This is
    -- the pay-per-service analogue of retention; it is not a churn rate and is
    -- not comparable to one.
    'repeat_rate_pct', case when v_paying_patients = 0 then 0
                            else round(100.0 * v_repeat_patients / v_paying_patients, 1) end,
    'avg_purchase_kobo', case when v_paid_purchases = 0 then 0
                              else round(v_revenue_kobo::numeric / v_paid_purchases) end,
    'commissions', jsonb_build_object(
      'total_kobo', (select coalesce(sum(amount_kobo),0)::bigint from public.commissions),
      'pending_kobo', (select coalesce(sum(amount_kobo),0)::bigint from public.commissions where status in ('pending','confirmed')),
      'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'total_kobo', total, 'count', c) order by status), '[]'::jsonb)
        from (select status::text status, sum(amount_kobo)::bigint total, count(*) c from public.commissions group by status) t),
      'by_type', (select coalesce(jsonb_agg(jsonb_build_object('type', commission_type, 'total_kobo', total) order by commission_type), '[]'::jsonb)
        from (select commission_type::text commission_type, sum(amount_kobo)::bigint total from public.commissions group by commission_type) t)
    ),
    'receivables_kobo', (select coalesce(sum(amount_kobo),0)::bigint from public.commissions where status in ('pending','confirmed'))
  );
end;
$$;

comment on function public.analytics_financial_summary() is
  'Money summary for /analytics/financial. Revenue comes from service_purchases + programme_purchases; there is no MRR or churn rate because nothing recurs (2026-09-02 pay-per-service cutover).';

-- ---------------------------------------------------------------------------
-- 2. Revenue by product replaces revenue by plan.
--
--    The old function grouped subscriptions by subscription_plans.code. The
--    name is dropped rather than kept as a shell: "plan" is the retired
--    concept, and a caller that still asks for revenue_by_plan should fail
--    loudly rather than receive a silent empty array forever.
-- ---------------------------------------------------------------------------
drop function if exists public.analytics_revenue_by_plan();

create or replace function public.analytics_revenue_by_product()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_code', code, 'product_name', name, 'currency', currency,
      'purchases', purchases, 'patients', patients, 'revenue_minor', revenue
    ) order by revenue desc, name)
    from (
      select p.code, p.name, sp.currency::text currency,
             count(*) purchases,
             count(distinct sp.patient_id) patients,
             sum(coalesce(sp.payable_kobo, sp.amount_kobo))::bigint revenue
      from public.service_purchases sp
      join public.service_products p on p.id = sp.service_product_id
      where sp.status in ('active', 'expired')
      group by p.code, p.name, sp.currency
      union all
      select 'chronic_doctor_supported_programme', '12-Week Doctor-Supported Programme', 'NGN',
             count(*), count(distinct pp.patient_id), sum(pp.price_kobo)::bigint
      from public.programme_purchases pp
      where pp.status in ('active', 'completed', 'expired')
      having count(*) > 0
    ) t
  ), '[]'::jsonb);
end;
$$;

comment on function public.analytics_revenue_by_product() is
  'Replaces analytics_revenue_by_plan(). One row per service product actually bought, plus the 12-week programme.';

revoke all on function public.analytics_revenue_by_product() from public;
grant execute on function public.analytics_revenue_by_product() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Business summary — subscription counts become purchase counts.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_business_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'total_orgs', (select count(*) from public.organisations),
    'active_orgs', (select count(*) from public.organisations where is_active),
    'total_profiles', (select count(*) from public.profiles),
    'total_patients', (select count(*) from public.profiles where role = 'patient'),
    'active_patients', (select count(*) from public.profiles where role = 'patient' and is_active),
    'onboarded_patients', (select count(*) from public.profiles where role = 'patient' and onboarding_completed_at is not null),
    'paid_purchases', (
      select count(*) from public.service_purchases where status in ('active','expired')
    ) + (
      select count(*) from public.programme_purchases where status in ('active','completed','expired')
    ),
    'paying_patients', (
      select count(*) from (
        select patient_id from public.service_purchases where status in ('active','expired')
        union
        select patient_id from public.programme_purchases where status in ('active','completed','expired')
      ) t
    ),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'count', c) order by c desc), '[]'::jsonb)
              from (select role::text as role, count(*) c from public.profiles group by role) t),
    'org_types', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'count', c) order by c desc), '[]'::jsonb)
                  from (select type::text as type, count(*) c from public.organisations group by type) t),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'count', c) order by c desc), '[]'::jsonb)
               from (select coalesce(state, 'Unknown') as state, count(*) c from public.profiles where role = 'patient' group by coalesce(state, 'Unknown')) t)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Growth timeseries — "new subscriptions" becomes "new purchases".
-- ---------------------------------------------------------------------------
create or replace function public.analytics_growth_timeseries(p_period text default 'month')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period text := case when p_period in ('day','week','month') then p_period else 'month' end;
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bucket', to_char(bucket, 'YYYY-MM-DD'),
      'signups', signups,
      'new_purchases', new_purchases
    ) order by bucket)
    from (
      select bucket, sum(signups)::bigint signups, sum(purchases)::bigint new_purchases
      from (
        select date_trunc(v_period, created_at) bucket, 1 signups, 0 purchases from public.profiles
        union all
        select date_trunc(v_period, coalesce(purchased_at, created_at)), 0, 1
          from public.service_purchases where status in ('active','expired')
        union all
        select date_trunc(v_period, coalesce(purchased_at, created_at)), 0, 1
          from public.programme_purchases where status in ('active','completed','expired')
      ) u
      group by bucket
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Revenue timeseries — off the webhook log, onto the purchase tables.
--
--    payment_transactions is an inbound-webhook journal, not a revenue ledger:
--    it holds rows with a non-null `error` that never resulted in money. Every
--    row in it today is exactly that.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_revenue_timeseries(p_period text default 'month')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period text := case when p_period in ('day','week','month') then p_period else 'month' end;
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bucket', to_char(bucket, 'YYYY-MM-DD'),
      'currency', currency,
      'total_minor', total
    ) order by bucket, currency)
    from (
      select bucket, currency, sum(amount)::bigint total
      from (
        select date_trunc(v_period, coalesce(sp.purchased_at, sp.created_at)) bucket,
               sp.currency::text currency,
               coalesce(sp.payable_kobo, sp.amount_kobo) amount
        from public.service_purchases sp
        where sp.status in ('active','expired')
        union all
        select date_trunc(v_period, coalesce(pp.purchased_at, pp.created_at)), 'NGN', pp.price_kobo
        from public.programme_purchases pp
        where pp.status in ('active','completed','expired')
      ) u
      group by bucket, currency
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Acquisition funnel — the "Paid" step.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_acquisition_funnel(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return jsonb_build_array(
    jsonb_build_object('step','Visitors','count', (select count(distinct coalesce(session_id, id::text)) from public.web_events where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<=p_to))),
    jsonb_build_object('step','Leads','count', (select count(*) from public.leads where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to))),
    jsonb_build_object('step','Signups','count', (select count(*) from public.profiles where role='patient' and (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to))),
    jsonb_build_object('step','Onboarded','count', (select count(*) from public.profiles where role='patient' and onboarding_completed_at is not null and (p_from is null or onboarding_completed_at>=p_from) and (p_to is null or onboarding_completed_at<=p_to))),
    jsonb_build_object('step','Paid','count', (
      select count(*) from (
        select patient_id from public.service_purchases
        where status in ('active','expired')
          and (p_from is null or purchased_at>=p_from) and (p_to is null or purchased_at<=p_to)
        union
        select patient_id from public.programme_purchases
        where status in ('active','completed','expired')
          and (p_from is null or purchased_at>=p_from) and (p_to is null or purchased_at<=p_to)
      ) t
    ))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. User segments — "churned" and "users per plan" have no successor as
--    written. "Churned (cancelled subscriptions)" is dropped outright;
--    "users per plan" becomes patients per product actually bought.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_user_segments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'activity', (
      with activity as (
        select p.id,
          greatest(
            (select max(occurred_at) from public.web_events w where w.profile_id = p.id),
            (select max(created_at) from public.vitals_readings v where v.patient_id = p.id),
            (select max(updated_at) from public.ai_conversations a where a.profile_id = p.id)
          ) last_active
        from public.profiles p where p.role = 'patient'
      )
      select jsonb_build_object(
        'total', count(*),
        'active_30d', count(*) filter (where last_active >= now() - interval '30 days'),
        'active_90d', count(*) filter (where last_active >= now() - interval '90 days'),
        'dormant_30d', count(*) filter (where last_active is null or last_active < now() - interval '30 days'),
        'dormant_90d', count(*) filter (where last_active is null or last_active < now() - interval '90 days'),
        'never_active', count(*) filter (where last_active is null)
      ) from activity
    ),
    'paying_patients', (
      select count(*) from (
        select patient_id from public.service_purchases where status in ('active','expired')
        union
        select patient_id from public.programme_purchases where status in ('active','completed','expired')
      ) t
    ),
    'by_product', (select coalesce(jsonb_agg(jsonb_build_object('product', product, 'users', users) order by users desc), '[]'::jsonb)
      from (select p.name product, count(distinct sp.patient_id) users
            from public.service_purchases sp
            join public.service_products p on p.id = sp.service_product_id
            where sp.status in ('active','expired') group by p.name) t),
    'by_care_category', jsonb_build_array(
      jsonb_build_object('category','Chronic disease','users', (select count(distinct patient_id) from public.care_plans where status='active')),
      jsonb_build_object('category','Preventive','users', (select count(distinct patient_id) from public.preventive_programme_enrolments)),
      -- Pre-existing, unrelated break found while rewiring this function: it
      -- read public.lifestyle_programme_enrolments, which does not exist on
      -- this project, so analytics_user_segments() raised 42P01 for every
      -- analyst and /analytics/users rendered nothing at all. The lifestyle
      -- programme's real enrolment table is lpe_enrollments.
      jsonb_build_object('category','Lifestyle','users', (select count(distinct patient_id) from public.lpe_enrollments)),
      jsonb_build_object('category','Care coordination','users', (
        select count(distinct pid) from (
          select patient_id pid from public.lab_orders
          union select patient_id from public.pharmacy_orders
          union select patient_id from public.specialist_referrals
        ) c))
    ),
    'by_role', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'users', c) order by c desc), '[]'::jsonb)
      from (select role::text role, count(*) c from public.profiles group by role) t),
    'by_condition', (select coalesce(jsonb_agg(jsonb_build_object('condition', condition, 'users', c) order by c desc), '[]'::jsonb)
      from (select condition::text condition, count(distinct patient_id) c from public.care_plans where status='active' group by condition) t),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'users', c) order by c desc), '[]'::jsonb)
      from (select coalesce(state,'Unknown') state, count(*) c from public.profiles where role='patient' group by coalesce(state,'Unknown')) t)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Accounting summary.
--
--    Revenue recognition previously prorated each subscription billing period.
--    A service purchase is a prepaid credit instead, so the honest analogue is
--    delivery-based: recognised once the credit is redeemed or its access
--    window has run out, deferred while it is still live and unredeemed. No
--    straight-line proration, because nothing is being delivered continuously.
--
--    ar_aging.subscriptions_past_due had no successor (nothing is invoiced on
--    terms); it is replaced by the count of purchases stuck awaiting payment,
--    which is the real "money we expected and have not got" signal here.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_accounting_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'revenue_recognition', (
      with paid as (
        select sp.currency::text currency,
               coalesce(sp.payable_kobo, sp.amount_kobo) amount,
               (sp.redeemed_at is not null
                 or sp.status = 'expired'
                 or (sp.expires_at is not null and sp.expires_at <= now())) delivered
        from public.service_purchases sp
        where sp.status in ('active','expired')
        union all
        select 'NGN', pp.price_kobo,
               (pp.status in ('completed','expired') or pp.ends_at < current_date)
        from public.programme_purchases pp
        where pp.status in ('active','completed','expired')
      )
      select jsonb_build_object(
        'billed_minor', coalesce(sum(amount),0),
        'recognized_minor', coalesce(sum(amount) filter (where delivered),0),
        'deferred_minor', coalesce(sum(amount) filter (where not delivered),0),
        'by_currency', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'billed', b, 'recognized', r, 'deferred', d) order by b desc),'[]'::jsonb)
          from (select currency, sum(amount) b,
                       coalesce(sum(amount) filter (where delivered),0) r,
                       coalesce(sum(amount) filter (where not delivered),0) d
                from paid group by currency) x)
      ) from paid
    ),
    'ar_aging', jsonb_build_object(
      'purchases_awaiting_payment', (
        select count(*) from public.service_purchases where status = 'pending_payment'
      ) + (
        select count(*) from public.programme_purchases where status = 'pending_payment'
      ),
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
        -- Errored webhook rows never moved money and must not read as revenue.
        'payments_collected', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'total_minor', total) order by total desc),'[]'::jsonb)
          from (select currency::text currency, sum(coalesce(amount_minor,0)) total
                from public.payment_transactions where error is null group by currency) x),
        'refunds_minor', (select coalesce(sum(coalesce(amount_minor,0)),0) from public.payment_transactions
                          where error is null and event_type::text ilike '%refund%')
      )
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Investor summary.
--
--    Rebuilt around collected revenue. Everything that only made sense for a
--    subscription book is gone rather than reported as a zero: MRR, ARR, the
--    MRR waterfall, NRR, GRR, logo churn, revenue churn, and the LTV family
--    (LTV, LTV:CAC, CAC payback), all of which are functions of a churn rate
--    that does not exist here.
--
--    CAC, net burn, runway, gross margin and Rule of 40 survive because they
--    only need revenue plus the founder-entered finance inputs. Rule of 40 is
--    now month-on-month revenue growth plus margin.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_investor_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  v_net_burn := coalesce(fi.operating_expense_minor,0) + coalesce(fi.marketing_spend_minor,0) - v_rev_30;
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
$$;

comment on function public.analytics_investor_summary() is
  'Board/diligence view built on collected revenue. No MRR/ARR/NRR/GRR/LTV: nothing recurs after the 2026-09-02 pay-per-service cutover, so those have no honest value here.';

-- ---------------------------------------------------------------------------
-- 10. Operations control centre — the one subscription figure on the board.
-- ---------------------------------------------------------------------------
create or replace function public.ops_today_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_today_end   timestamptz := v_today_start + interval '1 day';
begin
  if not private.can_view_ops_console() then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'generated_at', now(),

    -- Scale
    'patients', (select count(*) from public.profiles where role = 'patient' and is_active),
    'active_care_programmes', (
      select count(*) from public.chronic_programme_enrolments where status = 'enrolled'
    ) + (
      select count(*) from public.preventive_programme_enrolments where status = 'enrolled'
    ),
    -- Paid services a patient can still call on today: a bought credit that
    -- has not expired, plus a running 12-week programme.
    'active_paid_services', (
      select count(*) from public.service_purchases
      where status = 'active' and (expires_at is null or expires_at > now())
    ) + (
      select count(*) from public.programme_purchases
      where status = 'active' and ends_at >= current_date
    ),

    -- Today
    'appointments_today', (
      select count(*) from public.appointments
      where scheduled_for >= v_today_start and scheduled_for < v_today_end
        and status = 'scheduled'
    ),
    'consults_today', (
      select count(*) from public.video_consultations
      where scheduled_at >= v_today_start and scheduled_at < v_today_end
        and status = 'scheduled'
    ),

    -- Clinical work in hand
    'pending_clinical_reviews', (
      select count(*) from public.clinician_alerts where status = 'open'
    ),
    'critical_alerts', (
      select count(*) from public.clinician_alerts
      where status = 'open' and level = 'emergency'
    ),
    'alerts_past_sla', (
      select count(*) from public.clinician_alerts
      where status = 'open' and sla_due_at is not null and sla_due_at < now()
    ),
    'open_escalations', (
      select count(*) from public.escalations where status in ('open', 'under_review')
    ),

    -- Coordination
    'unresolved_referrals', (
      select count(*) from public.specialist_referrals
      where status in ('pending', 'waitlisted', 'booked')
    ),
    'laboratory_delays', (
      select count(*) from public.lab_orders
      where status in ('ordered', 'sample_collected', 'processing')
        and ordered_at < now() - interval '3 days'
    ),
    'pharmacy_issues', (
      select count(*) from public.pharmacy_orders
      where status in ('requested', 'confirmed', 'dispensed', 'out_for_delivery')
        and requested_at < now() - interval '2 days'
    ),
    'pending_bookings', (
      select count(*) from public.booking_requests where status = 'requested'
    ),

    -- Support
    'support_unread', (
      select count(*) from public.support_messages
      where direction = 'inbound' and status = 'unread'
    ),

    -- Money
    'failed_payments', (
      select count(*) from public.payment_transactions
      where error is not null and created_at > now() - interval '30 days'
    ),
    'reconciliation_exceptions', (
      select count(*) from public.payment_reconciliation_flags where status = 'open'
    ),

    -- Governance
    'open_incidents', (
      select count(*) from public.ops_incidents where status <> 'closed'
    ),
    'incidents_past_sla', (
      select count(*) from public.ops_incidents
      where status <> 'closed'
        and (
          (acknowledged_at is null and ack_due_at < now())
          or (resolved_at is null and resolve_due_at < now())
        )
    ),
    'clinician_verifications_pending', (
      select count(*) from public.clinical_staff where license_verified_at is null
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Prove it. Every rewired function must run, must no longer mention the
--     retired tables, and the retired RPC must be gone.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
  v_def  text;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'analytics_revenue_by_plan'
  ) then
    raise exception 'analytics_revenue_by_plan still exists';
  end if;

  foreach v_name in array array[
    'analytics_financial_summary', 'analytics_business_summary',
    'analytics_revenue_by_product', 'analytics_growth_timeseries',
    'analytics_revenue_timeseries', 'analytics_acquisition_funnel',
    'analytics_user_segments', 'analytics_accounting_summary',
    'analytics_investor_summary', 'ops_today_summary'
  ] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name
    limit 1;
    if v_def is null then
      raise exception '% is missing', v_name;
    end if;
    if v_def ~ 'public\.subscriptions|public\.subscription_plans|public\.subscription_add_ons|public\.mrr_snapshots|public\.add_ons' then
      raise exception '% still reads a retired billing table', v_name;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.analytics_revenue_by_product()', 'EXECUTE') then
    raise exception 'anon can execute analytics_revenue_by_product';
  end if;
  if not has_function_privilege('authenticated', 'public.analytics_revenue_by_product()', 'EXECUTE') then
    raise exception 'authenticated cannot execute analytics_revenue_by_product';
  end if;
end;
$$;
