-- Tarragon Health — Platform Analytics & Audit Console (cross-org read RPCs)
--
-- The 'analyst' role (added in 20260717180633) is platform-wide but gets NO
-- broad RLS grants on base tables. Every read flows through the SECURITY
-- DEFINER functions below, each of which returns nothing unless the caller is
-- an analyst (private.is_analyst()). The surfaces are AGGREGATES — counts,
-- sums, distributions, time-series — never raw patient rows, keeping PHI
-- exposure minimal (NDPR). The single row-level surface is the audit log, whose
-- rows are actor/action/entity metadata (not clinical PHI), delivered through a
-- gated, filtered, paginated RPC. Same structural pattern as the pharmacist
-- surface (20260716178000): isolation lives in one helper, enforced everywhere.

-- ---------------------------------------------------------------------------
-- Gate helper: true only for a signed-in 'analyst' account.
-- ---------------------------------------------------------------------------
create or replace function private.is_analyst()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'analyst'
  );
$$;

-- ===========================================================================
-- BUSINESS
-- ===========================================================================
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
    'total_subscriptions', (select count(*) from public.subscriptions),
    'active_subscriptions', (select count(*) from public.subscriptions where status in ('active','trialing')),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'count', c) order by c desc), '[]'::jsonb)
              from (select role::text as role, count(*) c from public.profiles group by role) t),
    'org_types', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'count', c) order by c desc), '[]'::jsonb)
                  from (select type::text as type, count(*) c from public.organisations group by type) t),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'count', c) order by c desc), '[]'::jsonb)
               from (select coalesce(state, 'Unknown') as state, count(*) c from public.profiles where role = 'patient' group by coalesce(state, 'Unknown')) t)
  );
end;
$$;

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
      'new_subscriptions', new_subs
    ) order by bucket)
    from (
      select bucket, sum(signups)::bigint signups, sum(new_subs)::bigint new_subs
      from (
        select date_trunc(v_period, created_at) bucket, 1 signups, 0 new_subs from public.profiles
        union all
        select date_trunc(v_period, coalesce(started_at, created_at)), 0, 1 from public.subscriptions
      ) u
      group by bucket
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- FINANCIAL  (amounts stay in the smallest unit — kobo for NGN)
-- ===========================================================================
create or replace function public.analytics_financial_summary()
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
    'mrr_by_currency', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'mrr_minor', mrr) order by currency), '[]'::jsonb)
      from (
        select currency::text currency,
               sum(case when interval = 'yearly' then coalesce(amount_minor,0)/12 else coalesce(amount_minor,0) end)::bigint mrr
        from public.subscriptions where status in ('active','trialing') group by currency
      ) t),
    'revenue_by_currency', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'total_minor', total) order by currency), '[]'::jsonb)
      from (select currency::text currency, sum(coalesce(amount_minor,0))::bigint total from public.payment_transactions group by currency) t),
    'active_subscriptions', (select count(*) from public.subscriptions where status in ('active','trialing')),
    'cancelled_subscriptions', (select count(*) from public.subscriptions where status = 'cancelled'),
    'churn_rate', (select case when count(*) = 0 then 0
                          else round(100.0 * count(*) filter (where status = 'cancelled') / count(*), 1) end
                   from public.subscriptions),
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
      select date_trunc(v_period, coalesce(processed_at, created_at)) bucket,
             currency::text currency, sum(coalesce(amount_minor,0))::bigint total
      from public.payment_transactions group by 1, 2
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.analytics_revenue_by_plan()
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
      'plan_code', code, 'plan_name', name, 'currency', currency,
      'subscribers', subs, 'mrr_minor', mrr
    ) order by mrr desc)
    from (
      select pl.code, pl.name, s.currency::text currency, count(*) subs,
             sum(case when s.interval = 'yearly' then coalesce(s.amount_minor,0)/12 else coalesce(s.amount_minor,0) end)::bigint mrr
      from public.subscriptions s
      join public.subscription_plans pl on pl.id = s.plan_id
      where s.status in ('active','trialing')
      group by pl.code, pl.name, s.currency
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- POPULATION HEALTH  (aggregates only — never raw patient rows)
-- ===========================================================================
create or replace function public.analytics_population_summary()
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
    'total_patients', (select count(*) from public.profiles where role = 'patient'),
    'condition_prevalence', (select coalesce(jsonb_agg(jsonb_build_object('condition', condition, 'patients', c) order by c desc), '[]'::jsonb)
      from (select condition::text condition, count(distinct patient_id) c from public.care_plans where status = 'active' group by condition) t),
    'risk_distribution', (select coalesce(jsonb_agg(jsonb_build_object('risk_level', risk_level, 'patients', c) order by c desc), '[]'::jsonb)
      from (
        select risk_level::text risk_level, count(*) c
        from (select distinct on (patient_id) patient_id, risk_level from public.patient_risk_scores order by patient_id, computed_at desc) latest
        group by risk_level
      ) t),
    'screening_counts', jsonb_build_object(
      'total', (select count(*) from public.screening_results),
      'abnormal', (select count(*) from public.screening_results where result_status in ('abnormal','critical'))
    ),
    'abnormal_screening_rate', (select case when count(*) = 0 then 0
      else round(100.0 * count(*) filter (where result_status in ('abnormal','critical')) / count(*), 1) end
      from public.screening_results),
    'care_gaps', (select coalesce(jsonb_agg(jsonb_build_object('gap_type', gap_type, 'count', c) order by c desc), '[]'::jsonb)
      from (select gap_type::text gap_type, count(*) c from public.patient_care_gaps group by gap_type) t),
    'age_bands', (select coalesce(jsonb_agg(jsonb_build_object('band', band, 'count', c) order by ord), '[]'::jsonb)
      from (
        select band, ord, count(*) c
        from (
          select
            case when age < 18 then '0-17' when age < 30 then '18-29' when age < 45 then '30-44'
                 when age < 60 then '45-59' when age < 75 then '60-74' else '75+' end band,
            case when age < 18 then 1 when age < 30 then 2 when age < 45 then 3
                 when age < 60 then 4 when age < 75 then 5 else 6 end ord
          from (select extract(year from age(date_of_birth))::int age from public.profiles
                where role = 'patient' and date_of_birth is not null) a
        ) x group by band, ord
      ) t),
    'sex_distribution', (select coalesce(jsonb_agg(jsonb_build_object('sex', sex, 'count', c) order by sex), '[]'::jsonb)
      from (select coalesce(sex::text, 'unknown') sex, count(*) c from public.profiles where role = 'patient' group by coalesce(sex::text, 'unknown')) t)
  );
end;
$$;

-- ===========================================================================
-- AUDIT LOG  (row-level metadata; filtered + paginated)
-- ===========================================================================
create or replace function public.analytics_audit_log(
  p_action text default null,
  p_entity_type text default null,
  p_org uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
begin
  if not private.is_analyst() then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  end if;
  select count(*) into v_total from public.audit_log a
  where (p_action is null or a.action = p_action)
    and (p_entity_type is null or a.entity_type = p_entity_type)
    and (p_org is null or a.organisation_id = p_org)
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at <= p_to);
  return jsonb_build_object(
    'total', v_total,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'created_at', a.created_at, 'action', a.action,
        'entity_type', a.entity_type, 'entity_id', a.entity_id,
        'actor_name', p.full_name, 'organisation_name', o.name, 'event', a.event
      ) order by a.created_at desc)
      from (
        select * from public.audit_log a2
        where (p_action is null or a2.action = p_action)
          and (p_entity_type is null or a2.entity_type = p_entity_type)
          and (p_org is null or a2.organisation_id = p_org)
          and (p_from is null or a2.created_at >= p_from)
          and (p_to is null or a2.created_at <= p_to)
        order by a2.created_at desc
        limit v_limit offset v_offset
      ) a
      left join public.profiles p on p.id = a.actor_id
      left join public.organisations o on o.id = a.organisation_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.analytics_audit_summary(
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
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.audit_log a
              where (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at <= p_to)),
    'by_action', (select coalesce(jsonb_agg(jsonb_build_object('action', action, 'count', c) order by c desc), '[]'::jsonb)
      from (select action, count(*) c from public.audit_log
            where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
            group by action) t),
    'by_entity', (select coalesce(jsonb_agg(jsonb_build_object('entity_type', entity_type, 'count', c) order by c desc), '[]'::jsonb)
      from (select coalesce(entity_type, 'unknown') entity_type, count(*) c from public.audit_log
            where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
            group by coalesce(entity_type, 'unknown')) t),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('bucket', to_char(bucket, 'YYYY-MM-DD'), 'count', c) order by bucket), '[]'::jsonb)
      from (select date_trunc('day', created_at) bucket, count(*) c from public.audit_log
            where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
            group by 1) t)
  );
end;
$$;

-- Lock down: these run as definer, so keep anon out entirely; authenticated
-- callers are still gated to nothing unless private.is_analyst() is true.
revoke execute on function public.analytics_business_summary() from anon;
revoke execute on function public.analytics_growth_timeseries(text) from anon;
revoke execute on function public.analytics_financial_summary() from anon;
revoke execute on function public.analytics_revenue_timeseries(text) from anon;
revoke execute on function public.analytics_revenue_by_plan() from anon;
revoke execute on function public.analytics_population_summary() from anon;
revoke execute on function public.analytics_audit_log(text, text, uuid, timestamptz, timestamptz, int, int) from anon;
revoke execute on function public.analytics_audit_summary(timestamptz, timestamptz) from anon;
