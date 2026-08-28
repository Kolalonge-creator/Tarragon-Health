create or replace function public.analytics_alert_burden()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object('per_clinician', coalesce(jsonb_agg(t), '[]'::jsonb))
    into v_result
  from (
    select
      cs.id as clinical_staff_id,
      cs.full_name,
      cs.doctor_tier,
      count(*) filter (where ca.status in ('open', 'acknowledged')) as open_owned,
      count(*) filter (where ca.status in ('open', 'acknowledged') and ca.severity >= 3) as open_owned_urgent_plus,
      round(avg(extract(epoch from (now() - ca.created_at)) / 3600) filter (where ca.status in ('open', 'acknowledged')), 1) as avg_age_hours
    from public.clinical_staff cs
    join public.clinician_alerts ca on ca.responsible_clinician_id = cs.id
    where cs.active
    group by cs.id, cs.full_name, cs.doctor_tier
    having count(*) filter (where ca.status in ('open', 'acknowledged')) > 0
    order by count(*) filter (where ca.status in ('open', 'acknowledged')) desc
  ) t;

  return coalesce(v_result, jsonb_build_object('per_clinician', '[]'::jsonb)) || jsonb_build_object(
    'unassigned_important_open', (
      select count(*) from public.clinician_alerts
      where status in ('open', 'acknowledged') and severity >= 2 and responsible_clinician_id is null
    )
  );
end;
$$;

comment on function public.analytics_alert_burden() is
  'Alert burden per clinician (8.7, 8.13): open+acknowledged alerts currently owned by each active clinical_staff member (responsible_clinician_id), how many of those are severity>=3, and their average age -- plus a platform-wide count of important (severity>=2) alerts nobody owns yet, the direct visibility mechanism for the staffing gaps private.classify_and_assign_clinician_alert() fails open on (part 2b) rather than blocking.';

revoke all on function public.analytics_alert_burden() from public, anon;
grant execute on function public.analytics_alert_burden() to authenticated;

create or replace function public.analytics_alert_quality(
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'total', count(*),
    'by_category', (
      select coalesce(jsonb_object_agg(category, cnt), '{}'::jsonb)
      from (select category, count(*) as cnt from public.clinician_alerts where created_at between p_from and p_to group by category) s
    ),
    'by_severity', (
      select coalesce(jsonb_object_agg(severity, cnt), '{}'::jsonb)
      from (select severity, count(*) as cnt from public.clinician_alerts where created_at between p_from and p_to group by severity) s
    ),
    'avg_ack_minutes', round(avg(extract(epoch from (acknowledged_at - created_at)) / 60) filter (where acknowledged_at is not null), 1),
    'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at)) / 3600) filter (where resolved_at is not null), 1),
    'escalation_rate_pct', round(100.0 * count(*) filter (
      where id in (select clinician_alert_id from public.clinician_alert_ack_escalations)
    ) / nullif(count(*), 0), 1),
    'duplicate_rate_pct', round(100.0 * count(*) filter (where duplicate_of is not null) / nullif(count(*), 0), 1),
    'false_positive_rate_pct', round(
      100.0 * count(*) filter (where resolution_outcome = 'false_positive')
      / nullif(count(*) filter (where resolution_outcome is not null), 0), 1
    ),
    'suppressed_count', count(*) filter (where suppressed)
  )
  into v_result
  from public.clinician_alerts
  where created_at between p_from and p_to;

  return v_result;
end;
$$;

comment on function public.analytics_alert_quality(timestamptz, timestamptz) is
  'Alert System analytics (8.13) across every category/type_code, not just the abnormal-result pathway public.analytics_escalation_quality() already covers: volume, response/ack/resolution time, escalation rate (fraction that had to climb the ack-timeout ladder, part 4), duplicate rate (dedup_key matches, part 2b), false-positive rate (resolution_outcome, part 2b), and how many alerts are currently protocol-suppressed.';

revoke all on function public.analytics_alert_quality(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_alert_quality(timestamptz, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.analytics_alert_burden()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.analytics_alert_burden';
  end if;
  if has_function_privilege('anon', 'public.analytics_alert_quality(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.analytics_alert_quality';
  end if;
  raise notice 'PASS: analytics_alert_burden + analytics_alert_quality installed, anon denied';
end $$;
