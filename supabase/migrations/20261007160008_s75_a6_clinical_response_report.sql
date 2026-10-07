-- S75 A6 (spec 22.7 and 22.8; CMO decision S-9: no published numbers): how fast the care team responds and follows up, for admins and analysts only.
--
-- public.clinical_response_report(p_from, p_to) returns, over clinical_tasks and pages created in the window (default: the last 90 days):
--   * per task type and priority class: the median and 90th percentile time from creation to first claim and from creation to completion
--     (minutes), how many open tasks are past their due time now, and how many completed after their due time;
--   * per page role: median and 90th percentile time to acknowledge and to close (minutes), and how many are still unacknowledged;
--   * a data-quality strip: the share of joined members with at least one blood pressure reading in the last 30 days, and the share of day-90
--     outcome snapshots that are insufficient_data.
-- Descriptive only: no target, no comparison, no ranking, no claim about cause, and nothing here is for publication (S-9).
--
-- Small numbers: the platform minimum group (private.outcome_rule('min_cell'), the same value bp_control_report enforces) applies to every
-- group and to every individual measure. A group under the minimum returns only that it is withheld (no count); a measure with fewer than the
-- minimum values in a group is withheld on its own. No overall total is returned, so a withheld group cannot be found by subtraction.
-- Test accounts (task, claim, page or patient is_test) are never counted (INV-13).
-- Access: platform admin or analyst. Every read is written to the audit log (who and which window only), like bp_control_report.

create function public.clinical_response_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_min integer := (private.outcome_rule('min_cell') #>> '{}')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date := coalesce(p_from, v_today - 90);
  v_to date := coalesce(p_to, v_today);
  v_t_from timestamptz; v_t_to timestamptz;
  v_tasks jsonb; v_pages jsonb; v_withheld_t integer; v_withheld_p integer;
  v_members integer; v_members_bp integer; v_snap integer; v_snap_insuff integer; v_dq jsonb;
begin
  if v_uid is null or not (private.is_admin() or private.is_analyst()) then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  if v_min is null then raise exception 'outcome_config_missing'; end if;
  if v_to < v_from then raise exception 'range_invalid' using errcode = '22023'; end if;
  v_t_from := v_from::timestamp at time zone 'Africa/Lagos';
  v_t_to := (v_to + 1)::timestamp at time zone 'Africa/Lagos';

  -- ---- tasks
  with t as (
    select ct.id, ct.type, ct.priority_class, ct.state, ct.due_at, ct.created_at, ct.completed_at,
           (select min(c.claimed_at) from public.task_claims c where c.task_id = ct.id and not c.is_test) as first_claim
      from public.clinical_tasks ct
      join public.profiles p on p.id = ct.patient_id
     where not ct.is_test and not coalesce(p.is_test, false)
       and ct.created_at >= v_t_from and ct.created_at < v_t_to
  ), g as (
    select type, priority_class, count(*) n,
           count(*) filter (where first_claim is not null) n_claim,
           percentile_cont(0.5) within group (order by extract(epoch from first_claim - created_at) / 60.0) filter (where first_claim is not null) claim_p50,
           percentile_cont(0.9) within group (order by extract(epoch from first_claim - created_at) / 60.0) filter (where first_claim is not null) claim_p90,
           count(*) filter (where state = 'completed' and completed_at is not null) n_done,
           percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at) / 60.0) filter (where state = 'completed' and completed_at is not null) done_p50,
           percentile_cont(0.9) within group (order by extract(epoch from completed_at - created_at) / 60.0) filter (where state = 'completed' and completed_at is not null) done_p90,
           count(*) filter (where state not in ('completed', 'cancelled') and due_at < now()) overdue_open,
           count(*) filter (where state = 'completed' and completed_at > due_at) completed_late
      from t group by type, priority_class
  )
  select coalesce(jsonb_agg(case when n < v_min
            then jsonb_build_object('task_type', type, 'priority_class', priority_class, 'suppressed', true, 'reason', 'under_minimum')
            else jsonb_build_object('task_type', type, 'priority_class', priority_class, 'suppressed', false,
              'time_to_claim_minutes', case when n_claim >= v_min then jsonb_build_object('median', round(claim_p50::numeric, 1), 'p90', round(claim_p90::numeric, 1))
                                            else jsonb_build_object('suppressed', true, 'reason', 'under_minimum') end,
              'time_to_complete_minutes', case when n_done >= v_min then jsonb_build_object('median', round(done_p50::numeric, 1), 'p90', round(done_p90::numeric, 1))
                                               else jsonb_build_object('suppressed', true, 'reason', 'under_minimum') end,
              'overdue_open_now', overdue_open, 'completed_after_due', completed_late) end
            order by type, priority_class), '[]'::jsonb),
         count(*) filter (where n < v_min)
    into v_tasks, v_withheld_t from g;

  -- ---- pages
  with pg as (
    select role, sent_at, acknowledged_at, closed_at
      from public.pages
     where not is_test and sent_at >= v_t_from and sent_at < v_t_to
  ), g as (
    select role, count(*) n,
           count(*) filter (where acknowledged_at is not null) n_ack,
           percentile_cont(0.5) within group (order by extract(epoch from acknowledged_at - sent_at) / 60.0) filter (where acknowledged_at is not null) ack_p50,
           percentile_cont(0.9) within group (order by extract(epoch from acknowledged_at - sent_at) / 60.0) filter (where acknowledged_at is not null) ack_p90,
           count(*) filter (where closed_at is not null) n_closed,
           percentile_cont(0.5) within group (order by extract(epoch from closed_at - sent_at) / 60.0) filter (where closed_at is not null) close_p50,
           percentile_cont(0.9) within group (order by extract(epoch from closed_at - sent_at) / 60.0) filter (where closed_at is not null) close_p90,
           count(*) filter (where acknowledged_at is null and closed_at is null) unacknowledged_open
      from pg group by role
  )
  select coalesce(jsonb_agg(case when n < v_min
            then jsonb_build_object('page_role', role::text, 'suppressed', true, 'reason', 'under_minimum')
            else jsonb_build_object('page_role', role::text, 'suppressed', false,
              'time_to_acknowledge_minutes', case when n_ack >= v_min then jsonb_build_object('median', round(ack_p50::numeric, 1), 'p90', round(ack_p90::numeric, 1))
                                                  else jsonb_build_object('suppressed', true, 'reason', 'under_minimum') end,
              'time_to_close_minutes', case when n_closed >= v_min then jsonb_build_object('median', round(close_p50::numeric, 1), 'p90', round(close_p90::numeric, 1))
                                            else jsonb_build_object('suppressed', true, 'reason', 'under_minimum') end,
              'unacknowledged_open_now', unacknowledged_open) end
            order by role), '[]'::jsonb),
         count(*) filter (where n < v_min)
    into v_pages, v_withheld_p from g;

  -- ---- data quality
  select count(distinct m.patient_id),
         count(distinct m.patient_id) filter (where exists (
           select 1 from public.vitals_readings r
            where r.patient_id = m.patient_id and r.vital_type = 'blood_pressure' and r.systolic is not null and r.diastolic is not null
              and coalesce(r.validation_status::text, '') <> 'rejected' and r.taken_at >= now() - interval '30 days'))
    into v_members, v_members_bp
    from public.patient_memberships m join public.profiles p on p.id = m.patient_id
   where m.state = 'active' and not coalesce(p.is_test, false);
  select count(*), count(*) filter (where s.bp_status = 'insufficient_data')
    into v_snap, v_snap_insuff
    from public.outcome_snapshots s join public.profiles p on p.id = s.patient_id
   where not s.is_test and not coalesce(p.is_test, false) and s.day = 90 and s.anchor_date between v_from and v_to;
  v_dq := jsonb_build_object(
    'members_with_a_bp_reading_last_30_days_pct', case when v_members >= v_min then round(100.0 * v_members_bp / v_members, 1) end,
    'members_with_a_bp_reading_suppressed', v_members < v_min,
    'day90_snapshots_insufficient_data_pct', case when v_snap >= v_min then round(100.0 * v_snap_insuff / v_snap, 1) end,
    'day90_snapshots_suppressed', v_snap < v_min);

  perform private.log_audit('outcomes.clinical_response_report', 'outcome_report', null, jsonb_build_object('from', v_from, 'to', v_to));

  return jsonb_build_object(
    'minimum_cell', v_min,
    'config_version', (select version from public.outcome_config where is_active),
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'tasks', v_tasks, 'task_groups_withheld', v_withheld_t,
    'pages', v_pages, 'page_groups_withheld', v_withheld_p,
    'data_quality', v_dq,
    'descriptive_only', true,
    'not_for_publication', true,
    'generated_at', now());
end $$;
revoke all on function public.clinical_response_report(date, date) from public, anon;
grant execute on function public.clinical_response_report(date, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.clinical_response_report(date,date)', 'EXECUTE') then
    raise exception 'S75 A6: anon must not execute clinical_response_report';
  end if;
  if private.outcome_rule('min_cell') is null then raise exception 'S75 A6: no active outcome_config min_cell'; end if;
  raise notice 'PASS: S75 A6 clinical_response_report in place';
end $$;
