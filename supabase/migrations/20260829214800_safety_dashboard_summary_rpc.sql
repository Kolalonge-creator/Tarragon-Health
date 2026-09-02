-- Tarragon Health
-- Patient Safety gap-closure, item 4 of 5 (§89.14 "safety dashboard" of the
-- 2026-08-29 governance/safety spec audit). The exact six counts the spec
-- names (critical alerts / open safety events / near misses / overdue
-- actions / AI escalations / medication incidents) span two tables with no
-- existing single query covering both -- clinician_alerts (severity/SLA)
-- and clinical_incident_reports (category/severity). Confirmed live before
-- writing this: analytics_alert_burden()/analytics_alert_quality() already
-- exist and are real, but neither one alone produces this headline row, and
-- neither has any UI wiring yet (confirmed via grep across apps/web).
--
-- Same shape as analytics_alert_burden/analytics_alert_quality exactly:
-- security definer, private.is_analyst() gate returning '{}'::jsonb rather
-- than raising (an analyst-only page reads safely-empty data if the caller
-- somehow reaches it without the role, same posture as its two siblings),
-- revoke from public+anon, grant to authenticated.

create or replace function public.analytics_safety_dashboard_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_critical_alerts int;
  v_open_safety_events int;
  v_near_misses int;
  v_overdue_actions int;
  v_ai_escalations int;
  v_medication_incidents int;
  v_open_safeguarding_concerns int;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select count(*) into v_critical_alerts
  from public.clinician_alerts
  where severity = 4 and status in ('open', 'acknowledged');

  select count(*) into v_open_safety_events
  from public.clinical_incident_reports
  where status in ('open', 'under_review');

  select count(*) into v_near_misses
  from public.clinical_incident_reports
  where severity = 'near_miss';

  select count(*) into v_overdue_actions
  from public.clinician_alerts
  where status in ('open', 'acknowledged') and sla_due_at is not null and sla_due_at < now();

  select count(*) into v_ai_escalations
  from public.clinical_incident_reports
  where category = 'ai_recommendation_error';

  select count(*) into v_medication_incidents
  from public.clinical_incident_reports
  where category = 'medication_error';

  select count(*) into v_open_safeguarding_concerns
  from public.safeguarding_concerns
  where status in ('open', 'under_review');

  return jsonb_build_object(
    'critical_alerts', v_critical_alerts,
    'open_safety_events', v_open_safety_events,
    'near_misses', v_near_misses,
    'overdue_actions', v_overdue_actions,
    'ai_escalations', v_ai_escalations,
    'medication_incidents', v_medication_incidents,
    'open_safeguarding_concerns', v_open_safeguarding_concerns
  );
end;
$$;

comment on function public.analytics_safety_dashboard_summary() is
  'The six headline counts from docs spec §89.14''s dashboard mockup, plus open safeguarding concerns (§89.12). analyst-only (private.is_analyst()); returns {} rather than raising if the caller lacks that role, matching analytics_alert_burden/analytics_alert_quality.';

revoke all on function public.analytics_safety_dashboard_summary() from public;
revoke all on function public.analytics_safety_dashboard_summary() from anon;
grant execute on function public.analytics_safety_dashboard_summary() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'analytics_safety_dashboard_summary'
  ) then
    raise exception 'analytics_safety_dashboard_summary was not created';
  end if;

  if has_function_privilege('anon', 'public.analytics_safety_dashboard_summary()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_safety_dashboard_summary';
  end if;
  if not has_function_privilege('authenticated', 'public.analytics_safety_dashboard_summary()', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute analytics_safety_dashboard_summary';
  end if;

  raise notice 'PASS: analytics_safety_dashboard_summary created, anon denied, authenticated allowed';
end $$;
