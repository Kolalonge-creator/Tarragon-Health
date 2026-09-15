-- Operations & Command Centre (§96.3 executive dashboard, §96.4 patient-flow
-- funnel, §96.8 service-level monitoring, §96.18 audit trail) — 4 new
-- analyst-gated aggregate RPCs plus one extension of an existing RPC, all
-- following the established pattern in 20260717193112_analytics_console_phase2_rpcs.sql /
-- 20260828020801_alert_analytics_rpcs.sql: security definer, search_path='',
-- `if not private.is_analyst() then return <empty>; end if` gate, revoke from
-- public+anon / grant to authenticated, closing has_function_privilege assertion.
--
-- Deliberately excludes lab-turnaround and prescription-fulfilment metrics —
-- self-arranged fulfilment (2026-08-03) means those events largely happen
-- off-platform now; building them honestly needs a product decision on
-- patient self-logging, not just an aggregate query. lab_orders_by_status
-- below is a status-count breakdown only, no turnaround/avg-hours field.
--
-- Named analytics_screening_referral_funnel (not "patient_flow_funnel") to
-- avoid confusion with the live-but-uncommitted public.analytics_programme_funnel()
-- (a concurrent build's chronic-disease enrolment/control funnel — a
-- different thing entirely, checked live before writing this).

-- ===========================================================================
-- §96.3 Executive dashboard
-- ===========================================================================
create or replace function public.analytics_executive_summary()
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
    'active_patients', (select count(*) from public.profiles where role = 'patient' and is_active),
    'active_care_programmes', (select count(distinct patient_id) from public.care_plans where status = 'active'),
    'appointments_90d', (
      select jsonb_build_object(
        'booked', count(*),
        'completed', count(*) filter (where status = 'completed'),
        'no_show', count(*) filter (where status = 'no_show')
      )
      from public.appointments
      where scheduled_for >= now() - interval '90 days'
    ),
    'referrals', jsonb_build_object(
      'open', (select count(*) from public.specialist_referrals where status not in ('completed', 'closed', 'declined', 'draft')),
      'overdue', (select count(*) from public.patient_care_gaps where gap_type = 'overdue_referral')
    ),
    'lab_orders_by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
      from (select status::text status, count(*) c from public.lab_orders group by status) t
    ),
    'clinical_alerts', jsonb_build_object(
      'open', (select count(*) from public.clinician_alerts where status = 'open'),
      'critical', (select count(*) from public.clinician_alerts where status = 'open' and severity = 4)
    ),
    'care_gaps_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('gap_type', gap_type, 'count', c) order by c desc), '[]'::jsonb)
      from (select gap_type, count(*) c from public.patient_care_gaps group by gap_type) t
    )
  );
end;
$$;

comment on function public.analytics_executive_summary() is
  'Operations & Command Centre §96.3 executive dashboard: active patients/programmes, 90d appointment booked/completed/no-show, open+overdue referrals, lab order status distribution (counts only -- no turnaround, see file header), open+critical clinical alerts, care-gap breakdown. Deliberately excludes prescription-fulfilment and lab-turnaround metrics.';

revoke all on function public.analytics_executive_summary() from public, anon;
grant execute on function public.analytics_executive_summary() to authenticated;

-- ===========================================================================
-- §96.4 Screening -> referral -> treatment funnel
-- ===========================================================================
create or replace function public.analytics_screening_referral_funnel(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_screened bigint;
  v_abnormal bigint;
  v_reviewed bigint;
  v_referred bigint;
  v_specialist bigint;
  v_treated bigint;
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;

  select count(*) into v_screened from public.screening_results sr
    where (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  select count(*) into v_abnormal from public.screening_results sr
    where sr.result_status in ('abnormal', 'critical')
      and (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  -- "clinical_review" = screening_upgrades rows. NOTE: private.handle_abnormal_screening_result()
  -- auto-inserts one for every abnormal/critical result today, so this stage is architecturally
  -- near-1:1 with abnormal_result, not yet a distinct human-review gate -- shown as-is (honest,
  -- not padded), the dashboard's disclaimer banner should say so.
  select count(*) into v_reviewed from public.screening_upgrades su
    where (p_from is null or su.upgrade_at >= p_from) and (p_to is null or su.upgrade_at <= p_to);

  select count(*) into v_referred from public.specialist_referrals sr
    where sr.screening_upgrade_id is not null
      and (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  select count(*) into v_specialist from public.specialist_referrals sr
    where sr.screening_upgrade_id is not null and sr.booking_confirmed_at is not null
      and (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  select count(*) into v_treated from public.specialist_referrals sr
    where sr.screening_upgrade_id is not null and sr.treatment_plan_received_at is not null
      and (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  return jsonb_build_array(
    jsonb_build_object('stage', 'screened', 'count', v_screened, 'drop_off_pct', 0),
    jsonb_build_object('stage', 'abnormal_result', 'count', v_abnormal,
      'drop_off_pct', case when v_screened = 0 then 0 else round(100.0 * greatest(v_screened - v_abnormal, 0) / v_screened, 1) end),
    jsonb_build_object('stage', 'clinical_review', 'count', v_reviewed,
      'drop_off_pct', case when v_abnormal = 0 then 0 else round(100.0 * greatest(v_abnormal - v_reviewed, 0) / v_abnormal, 1) end),
    jsonb_build_object('stage', 'referred', 'count', v_referred,
      'drop_off_pct', case when v_reviewed = 0 then 0 else round(100.0 * greatest(v_reviewed - v_referred, 0) / v_reviewed, 1) end),
    jsonb_build_object('stage', 'specialist_booked', 'count', v_specialist,
      'drop_off_pct', case when v_referred = 0 then 0 else round(100.0 * greatest(v_referred - v_specialist, 0) / v_referred, 1) end),
    jsonb_build_object('stage', 'treatment', 'count', v_treated,
      'drop_off_pct', case when v_specialist = 0 then 0 else round(100.0 * greatest(v_specialist - v_treated, 0) / v_specialist, 1) end)
  );
end;
$$;

comment on function public.analytics_screening_referral_funnel(timestamptz, timestamptz) is
  'Operations & Command Centre §96.4: staged counts + drop-off down the screening -> abnormal result -> clinical review -> referral -> specialist booking -> treatment pipeline. Distinct from the live public.analytics_programme_funnel() (chronic-disease enrolment/control funnel, a different concept).';

revoke all on function public.analytics_screening_referral_funnel(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_screening_referral_funnel(timestamptz, timestamptz) to authenticated;

-- ===========================================================================
-- §96.8 Referral turnaround
-- ===========================================================================
create or replace function public.analytics_referral_turnaround()
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
    with booked as (
      select specialist_type,
        extract(epoch from (booking_confirmed_at - created_at)) / 3600.0 as hours_to_booking
      from public.specialist_referrals
      where created_at >= now() - interval '90 days'
        and booking_confirmed_at is not null
    ),
    treated as (
      select specialist_type,
        extract(epoch from (treatment_plan_received_at - created_at)) / 3600.0 as hours_to_treatment
      from public.specialist_referrals
      where created_at >= now() - interval '90 days'
        and treatment_plan_received_at is not null
    ),
    totals as (
      select specialist_type, count(*) total
      from public.specialist_referrals
      where created_at >= now() - interval '90 days'
      group by specialist_type
    )
    select jsonb_agg(jsonb_build_object(
      'specialist_type', tt.specialist_type::text,
      'referrals_90d', tt.total,
      'avg_hours_to_booking', (select round(avg(hours_to_booking)::numeric, 1) from booked b where b.specialist_type = tt.specialist_type),
      'median_hours_to_booking', (select round((percentile_cont(0.5) within group (order by hours_to_booking))::numeric, 1) from booked b where b.specialist_type = tt.specialist_type),
      'avg_hours_to_treatment', (select round(avg(hours_to_treatment)::numeric, 1) from treated tr where tr.specialist_type = tt.specialist_type)
    ) order by tt.total desc)
    from totals tt
  ), '[]'::jsonb);
end;
$$;

comment on function public.analytics_referral_turnaround() is
  'Operations & Command Centre §96.8: per specialist_type, 90d referral volume + avg/median hours to booking_confirmed_at + avg hours to treatment_plan_received_at. Excludes lab/pharmacy per the self-arranged-fulfilment carve-out.';

revoke all on function public.analytics_referral_turnaround() from public, anon;
grant execute on function public.analytics_referral_turnaround() to authenticated;

-- ===========================================================================
-- §96.8 Support (care_messages) first-response time
-- ===========================================================================
create or replace function public.analytics_support_response_time()
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
  return (
    with first_patient_msg as (
      select thread_id, min(created_at) as first_patient_at
      from public.care_messages
      where author_role = 'patient'
        and created_at >= now() - interval '90 days'
      group by thread_id
    ),
    first_reply as (
      select fpm.thread_id, min(cm.created_at) as first_reply_at
      from first_patient_msg fpm
      join public.care_messages cm
        on cm.thread_id = fpm.thread_id
        and cm.author_role = 'care_team'
        and cm.created_at > fpm.first_patient_at
      group by fpm.thread_id
    )
    select jsonb_build_object(
      'threads_90d', (select count(*) from first_patient_msg),
      'threads_with_reply', (select count(*) from first_reply),
      'avg_first_response_minutes', (
        select round(avg(extract(epoch from (fr.first_reply_at - fpm.first_patient_at)) / 60.0)::numeric, 1)
        from first_reply fr join first_patient_msg fpm on fpm.thread_id = fr.thread_id
      )
    )
  );
end;
$$;

comment on function public.analytics_support_response_time() is
  'Operations & Command Centre §96.8: 90d care_messages first-response time -- gap between the first patient message and the first care_team reply, per thread, averaged in minutes.';

revoke all on function public.analytics_support_response_time() from public, anon;
grant execute on function public.analytics_support_response_time() to authenticated;

-- ===========================================================================
-- §96.18 Audit trail: surface the reason/result columns
-- (20260829204722_audit_log_reason_and_result.sql) this RPC predates and has
-- silently been dropping ever since.
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
        'actor_name', p.full_name, 'organisation_name', o.name, 'event', a.event,
        'reason', a.reason, 'result', a.result
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

comment on function public.analytics_audit_log(text, text, uuid, timestamptz, timestamptz, int, int) is
  'Platform audit console read RPC. Extended 2026-08-29 (Operations & Command Centre §96.18) to surface the reason/result columns added by 20260829204722_audit_log_reason_and_result.sql, which this function had been silently dropping since.';

revoke all on function public.analytics_audit_log(text, text, uuid, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function public.analytics_audit_log(text, text, uuid, timestamptz, timestamptz, int, int) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.analytics_executive_summary()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_executive_summary';
  end if;
  if has_function_privilege('anon', 'public.analytics_screening_referral_funnel(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_screening_referral_funnel';
  end if;
  if has_function_privilege('anon', 'public.analytics_referral_turnaround()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_referral_turnaround';
  end if;
  if has_function_privilege('anon', 'public.analytics_support_response_time()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_support_response_time';
  end if;
  if has_function_privilege('anon', 'public.analytics_audit_log(text,text,uuid,timestamptz,timestamptz,int,int)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_audit_log';
  end if;
  if not has_function_privilege('authenticated', 'public.analytics_executive_summary()', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute analytics_executive_summary';
  end if;
  raise notice 'PASS: 4 new analytics RPCs + analytics_audit_log reason/result extension installed, anon denied, authenticated allowed';
end $$;
