-- Tarragon Health — Diagnostic Safety Pathway, part 6/6: the ops dashboard
-- (60.15/60.16), pathway + governance analytics (60.17/60.18), and the
-- per-episode clinical timeline (60.14).
--
-- Same posture as public.analytics_alert_burden()/analytics_alert_quality()
-- (20260828020801): SECURITY DEFINER, `if not private.is_analyst() then
-- return '{}'::jsonb end if` gate, revoke from anon/grant to authenticated,
-- platform-wide (not per-organisation — matches the existing analytics RPC
-- family exactly).
--
-- 60.14's "clinical timeline" is NOT a new table. public.patient_timeline
-- (20260717221852) already exists as the append-only unified activity feed
-- and already carries lab_abnormal/referral_created/referral_status_changed/
-- lab_completed rows for the exact source tables a diagnostic episode
-- touches — public.diagnostic_episode_timeline() just filters that existing
-- feed down to one episode's linked rows rather than duplicating it.

create or replace function public.diagnostic_safety_dashboard()
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
    'critical_results', (
      select count(*) from public.diagnostic_episodes
      where status = 'open' and result_status_at_open = 'critical'
    ),
    'awaiting_acknowledgement', (
      select count(*) from public.clinician_alerts
      where type_code = 'abnormal_result' and status = 'open'
    ),
    'abnormal_results', (
      select count(*) from public.diagnostic_episodes where status = 'open'
    ),
    'overdue_clinical_review', (
      select count(*) from public.diagnostic_episodes de
      join public.clinician_alerts ca on ca.id = de.clinician_alert_id
      where de.status = 'open' and de.reviewed_at is null and ca.sla_due_at < now()
    ),
    'pending_specialist_follow_up', (
      select count(*) from public.diagnostic_episodes
      where status = 'open' and requires_referral and referral_completed_at is null
    ),
    'pending_repeat_tests', (
      select count(*) from public.diagnostic_repeat_test_recalls
      where status in ('pending', 'patient_notified')
    ),
    -- 60.16 diagnostic safety alerts.
    'alerts', jsonb_build_object(
      'critical_unacknowledged', (
        select count(*) from public.diagnostic_episodes
        where status = 'open' and result_status_at_open = 'critical' and reviewed_at is null
      ),
      'abnormal_without_action', (
        select count(*) from public.diagnostic_episodes
        where status = 'open' and reviewed_at is not null
          and not requires_referral and not requires_repeat_test
          and follow_up_completed_at is null and opened_at < now() - interval '7 days'
      ),
      'specialist_referral_incomplete', (
        select count(*) from public.diagnostic_episodes de
        join public.specialist_referrals sr on sr.id = de.referral_id
        where de.status = 'open' and de.requires_referral and de.referral_completed_at is null
          and sr.appointment_date is not null and sr.appointment_date < now()
          and sr.status not in ('completed', 'declined')
      ),
      'repeat_investigation_overdue', (
        select count(*) from public.diagnostic_repeat_test_recalls
        where status in ('pending', 'patient_notified') and due_date < current_date
      )
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.diagnostic_safety_dashboard() is
  '60.15/60.16: the live diagnostic-safety ops dashboard counts (critical results, awaiting acknowledgement, abnormal results, overdue clinical review, pending specialist follow-up, pending repeat tests) plus a nested alerts object surfacing the four named alert conditions. Platform-wide, analyst-gated, same posture as analytics_alert_burden/analytics_alert_quality.';

revoke all on function public.diagnostic_safety_dashboard() from public, anon;
grant execute on function public.diagnostic_safety_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- 60.17 diagnostic pathway analytics.
-- ---------------------------------------------------------------------------
create or replace function public.diagnostic_pathway_analytics(
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
    'episodes_opened', count(*),
    'avg_review_time_hours', round(avg(extract(epoch from (reviewed_at - opened_at)) / 3600) filter (where reviewed_at is not null), 1),
    'avg_critical_response_time_hours', round(avg(extract(epoch from (reviewed_at - opened_at)) / 3600) filter (where reviewed_at is not null and result_status_at_open = 'critical'), 1),
    'avg_closure_time_hours', round(avg(extract(epoch from (closed_at - opened_at)) / 3600) filter (where closed_at is not null), 1),
    'patient_notification_rate_pct', round(100.0 * count(*) filter (where patient_informed_at is not null) / nullif(count(*), 0), 1),
    'referral_completion_rate_pct', round(
      100.0 * count(*) filter (where requires_referral and referral_completed_at is not null)
      / nullif(count(*) filter (where requires_referral), 0), 1
    ),
    'repeat_test_completion_rate_pct', round(
      100.0 * count(*) filter (where requires_repeat_test and repeat_test_completed_at is not null)
      / nullif(count(*) filter (where requires_repeat_test), 0), 1
    ),
    'closed_count', count(*) filter (where status = 'closed'),
    'still_open_count', count(*) filter (where status = 'open')
  )
  into v_result
  from public.diagnostic_episodes
  where opened_at between p_from and p_to;

  -- Result turnaround (order -> result) for the lab_orders behind these
  -- episodes' originating screening_results — a narrower, abnormal-result-
  -- scoped view of what lab_provider_turnaround_stats() already reports
  -- platform-wide for every order.
  v_result := v_result || jsonb_build_object(
    'avg_result_turnaround_hours', (
      select round(avg(extract(epoch from (lo.resulted_at - lo.ordered_at)) / 3600), 1)
      from public.diagnostic_episodes de
      join public.screening_results sres on sres.id = de.screening_result_id
      join public.lab_orders lo on lo.id = sres.lab_order_id
      where de.opened_at between p_from and p_to and lo.resulted_at is not null
    )
  );

  return v_result;
end;
$$;

comment on function public.diagnostic_pathway_analytics(timestamptz, timestamptz) is
  '60.17: result turnaround, review time, critical-result response time, abnormal-result closure time, referral completion rate, repeat-test completion rate, and patient notification rate for diagnostic_episodes opened in the window. Lab turnaround BY PROVIDER already exists (lab_provider_turnaround_stats/lab_partner_turnaround_stats) and is not duplicated here.';

revoke all on function public.diagnostic_pathway_analytics(timestamptz, timestamptz) from public, anon;
grant execute on function public.diagnostic_pathway_analytics(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 60.18 clinical governance analytics.
-- ---------------------------------------------------------------------------
create or replace function public.diagnostic_governance_analytics(
  p_from timestamptz default date_trunc('month', now()),
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
    'critical_results_received', count(*) filter (where result_status_at_open = 'critical'),
    'critical_reviewed', count(*) filter (where result_status_at_open = 'critical' and reviewed_at is not null),
    -- "Within the required timeframe" = before the linked alert's own
    -- governed SLA deadline (sla_due_at) — the same deadline
    -- private.escalate_overdue_clinician_alerts() already enforces, not a
    -- second, independently-invented number.
    'critical_reviewed_within_sla', (
      select count(*) from public.diagnostic_episodes de
      join public.clinician_alerts ca on ca.id = de.clinician_alert_id
      where de.result_status_at_open = 'critical' and de.opened_at between p_from and p_to
        and de.reviewed_at is not null and de.reviewed_at <= ca.sla_due_at
    ),
    'near_miss_count', count(*) filter (where outcome_flag = 'near_miss'),
    'harm_count', count(*) filter (where outcome_flag = 'harm'),
    -- 60.18 "which pathways have the highest follow-up failure?" — grouped
    -- by the same condition_triggered taxonomy screening_upgrades already
    -- uses, not a new classification.
    'follow_up_failure_by_condition', (
      select coalesce(jsonb_object_agg(condition, pct), '{}'::jsonb)
      from (
        select
          coalesce(condition::text, 'other') as condition,
          round(100.0 * count(*) filter (where follow_up_clinically_escalated_at is not null) / nullif(count(*), 0), 1) as pct
        from public.diagnostic_episodes
        where opened_at between p_from and p_to
        group by condition
      ) s
    )
  )
  into v_result
  from public.diagnostic_episodes
  where opened_at between p_from and p_to;

  return v_result;
end;
$$;

comment on function public.diagnostic_governance_analytics(timestamptz, timestamptz) is
  '60.18: critical results received/reviewed/reviewed-within-SLA this window, near-miss/harm counts (diagnostic_episodes.outcome_flag, clinician-flagged at closure — the only honest source for this, no data existed to infer it from before this feature), and follow-up-failure rate by condition_triggered. Lab-turnaround-by-provider is already answered by lab_provider_turnaround_stats()/lab_partner_turnaround_stats(), not duplicated here.';

revoke all on function public.diagnostic_governance_analytics(timestamptz, timestamptz) from public, anon;
grant execute on function public.diagnostic_governance_analytics(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 60.14 per-episode clinical timeline — filters the EXISTING patient_timeline
-- feed, does not duplicate it.
-- ---------------------------------------------------------------------------
create or replace function public.diagnostic_episode_timeline(p_episode_id uuid)
returns setof public.patient_timeline
language sql
stable
security definer
set search_path = ''
as $$
  select pt.*
  from public.patient_timeline pt
  join public.diagnostic_episodes de on de.id = p_episode_id
  where (de.patient_id = (select auth.uid()) or private.is_org_staff(de.organisation_id))
    and (
      (pt.source_table = 'screening_results' and pt.source_id = de.screening_result_id)
      or (pt.source_table = 'lab_orders' and pt.source_id in (
        select lab_order_id from public.screening_results where id = de.screening_result_id
        union
        select lab_order_id from public.screening_results where id = de.repeat_test_result_id
      ))
      or (pt.source_table = 'specialist_referrals' and pt.source_id = de.referral_id)
      or (pt.source_table = 'screening_results' and pt.source_id = de.repeat_test_result_id)
    )
  order by pt.occurred_at asc;
$$;

comment on function public.diagnostic_episode_timeline(uuid) is
  '60.14: the diagnostic episode''s clinical timeline, assembled by filtering the existing append-only patient_timeline feed down to the rows sourced from this episode''s linked screening_results/lab_orders/specialist_referrals — no new event log, no duplicated source of truth. RLS-equivalent access check (patient reads their own episode, org staff read their org''s) is done inside the function since it returns a setof from a table whose own RLS is bypassed under SECURITY DEFINER.';

revoke all on function public.diagnostic_episode_timeline(uuid) from public, anon;
grant execute on function public.diagnostic_episode_timeline(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.diagnostic_safety_dashboard()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.diagnostic_safety_dashboard';
  end if;
  if has_function_privilege('anon', 'public.diagnostic_pathway_analytics(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.diagnostic_pathway_analytics';
  end if;
  if has_function_privilege('anon', 'public.diagnostic_governance_analytics(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.diagnostic_governance_analytics';
  end if;
  if has_function_privilege('anon', 'public.diagnostic_episode_timeline(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.diagnostic_episode_timeline';
  end if;
  raise notice 'PASS: diagnostic safety dashboard + pathway/governance analytics + episode timeline RPCs installed, anon denied';
end $$;
