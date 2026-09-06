-- Tarragon Health — Patient Support & Service Centre, part 8/8: analytics.
--
-- §24.13 (tickets, response/resolution time, repeat contacts, category,
-- satisfaction, escalation rate) and the equivalent complaints-side numbers
-- feeding §24.14/§24.16 governance oversight. Same shape as
-- analytics_alert_burden/analytics_alert_quality (20260828020801): fail-
-- closed but non-raising (private.is_analyst() gate returns '{}'::jsonb,
-- not an error), SECURITY DEFINER, set search_path = '', a single jsonb
-- blob built with jsonb_build_object/jsonb_object_agg.

create or replace function public.analytics_support_ticket_summary(
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
    'from', p_from,
    'to', p_to,
    'total', count(*),
    'open_count', count(*) filter (where status not in ('resolved', 'closed')),
    'by_category', coalesce((
      select jsonb_object_agg(category, cnt) from (
        select category, count(*) as cnt from public.support_tickets
        where created_at between p_from and p_to group by category
      ) s
    ), '{}'::jsonb),
    'by_priority', coalesce((
      select jsonb_object_agg(priority, cnt) from (
        select priority, count(*) as cnt from public.support_tickets
        where created_at between p_from and p_to group by priority
      ) s
    ), '{}'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select status, count(*) as cnt from public.support_tickets
        where created_at between p_from and p_to group by status
      ) s
    ), '{}'::jsonb),
    'avg_first_response_minutes', (
      select round(avg(extract(epoch from (first_response_at - created_at)) / 60)::numeric, 1)
      from public.support_tickets
      where created_at between p_from and p_to and first_response_at is not null
    ),
    'avg_resolution_minutes', (
      select round(avg(extract(epoch from (resolved_at - created_at)) / 60)::numeric, 1)
      from public.support_tickets
      where created_at between p_from and p_to and resolved_at is not null
    ),
    'escalation_rate_pct', (
      select round(100.0 * count(*) filter (where escalated_alert_id is not null or technical_tier > 1) / greatest(count(*), 1), 1)
      from public.support_tickets
      where created_at between p_from and p_to
    ),
    'repeat_contact_rate_pct', (
      select round(100.0 * count(*) filter (where ticket_count > 1) / greatest(count(*), 1), 1)
      from (
        select patient_id, count(*) as ticket_count from public.support_tickets
        where created_at between p_from and p_to group by patient_id
      ) per_patient
    ),
    'avg_satisfaction', (
      select round(avg(satisfaction_score)::numeric, 2)
      from public.support_tickets
      where created_at between p_from and p_to and satisfaction_score is not null
    ),
    'satisfaction_response_count', (
      select count(*) from public.support_tickets
      where created_at between p_from and p_to and satisfaction_score is not null
    )
  ) into v_result
  from public.support_tickets
  where created_at between p_from and p_to;

  return v_result;
end;
$$;

comment on function public.analytics_support_ticket_summary(timestamptz, timestamptz) is
  'The §24.13 support-ticket analytics blob: volume by category/priority/status, avg first-response/resolution time, escalation rate (clinical or technical), repeat-contact rate, and CSAT. Gated by private.is_analyst(), fail-closed to {}.';

revoke execute on function public.analytics_support_ticket_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_support_ticket_summary(timestamptz, timestamptz) to authenticated;

create or replace function public.analytics_complaints_summary(
  p_from timestamptz default now() - interval '90 days',
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
    'from', p_from,
    'to', p_to,
    'total', count(*),
    'open_count', count(*) filter (where status <> 'governance_review'),
    'by_category', coalesce((
      select jsonb_object_agg(category, cnt) from (
        select category, count(*) as cnt from public.complaints
        where created_at between p_from and p_to group by category
      ) s
    ), '{}'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select status, count(*) as cnt from public.complaints
        where created_at between p_from and p_to group by status
      ) s
    ), '{}'::jsonb),
    'avg_acknowledgement_minutes', (
      select round(avg(extract(epoch from (acknowledged_at - created_at)) / 60)::numeric, 1)
      from public.complaints
      where created_at between p_from and p_to and acknowledged_at is not null
    ),
    'avg_resolution_minutes', (
      select round(avg(extract(epoch from (resolved_at - created_at)) / 60)::numeric, 1)
      from public.complaints
      where created_at between p_from and p_to and resolved_at is not null
    ),
    'incident_escalation_count', count(*) filter (where incident_report_id is not null),
    'governance_reviewed_count', count(*) filter (where status = 'governance_review')
  ) into v_result
  from public.complaints
  where created_at between p_from and p_to;

  return v_result;
end;
$$;

comment on function public.analytics_complaints_summary(timestamptz, timestamptz) is
  'The §24.14/§24.16 complaints analytics blob: volume by category/status, avg acknowledgement/resolution time, how many became formal clinical incidents (§24.15), how many completed governance review. Gated by private.is_analyst(), fail-closed to {}.';

revoke execute on function public.analytics_complaints_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_complaints_summary(timestamptz, timestamptz) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'analytics_support_ticket_summary'
  ) then
    raise exception 'analytics_support_ticket_summary was not created';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'analytics_complaints_summary'
  ) then
    raise exception 'analytics_complaints_summary was not created';
  end if;
  if has_function_privilege('anon', 'public.analytics_support_ticket_summary(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_support_ticket_summary';
  end if;
  if has_function_privilege('anon', 'public.analytics_complaints_summary(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_complaints_summary';
  end if;
  raise notice 'PASS: support-centre analytics RPCs in place, anon denied';
end $$;
