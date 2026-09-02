-- Tarragon Health — Care Management Engine, step 9
--
-- care_management_kpis: spec §3.20 — "Measure: programme enrolment,
-- adherence, completion, clinical outcomes, dropout, escalation, time to
-- intervention, time to control." Same RPC shape as the existing
-- htn_quality_metrics() (jsonb return, private.is_org_staff(p_org) enforced
-- inside the function body so it's safe to call from any admin/staff
-- surface) — this is the cross-programme equivalent, not a replacement for
-- that condition-specific audit.
--
-- "Time to intervention" / "time to control" are deliberately left out of
-- v1: control state (at-target vs above-target) is currently only modelled
-- for diabetes (chronic_control_state, 2026-08-21) with no equivalent for
-- hypertension or the other five programmes yet, and a cross-programme
-- number computed from an incomplete input would be misleading rather than
-- useful. The metrics below are the ones every programme can answer today.

create or replace function public.care_management_kpis(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_org_staff(p_org) then
    raise exception 'not authorised';
  end if;

  select jsonb_build_object(
    'programme_enrolments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'programme', ccp.name,
        'condition', ccp.condition,
        'enrolled', counts.enrolled,
        'completed', counts.completed,
        'withdrawn', counts.withdrawn
      ) order by ccp.launch_priority, ccp.name)
      from public.chronic_condition_programmes ccp
      join lateral (
        select
          count(*) filter (where e.status = 'enrolled') as enrolled,
          count(*) filter (where e.status = 'completed') as completed,
          count(*) filter (where e.status = 'withdrawn') as withdrawn
        from public.chronic_programme_enrolments e
        where e.programme_id = ccp.id and e.organisation_id = p_org
      ) counts on true
      where counts.enrolled + counts.completed + counts.withdrawn > 0
    ), '[]'::jsonb),

    'tasks_completion_rate_30d', (
      select case when count(*) filter (where status in ('completed', 'missed', 'expired', 'unable_to_complete', 'cancelled')) = 0
        then null
        else round(
          100.0 * count(*) filter (where status = 'completed')
          / count(*) filter (where status in ('completed', 'missed', 'expired', 'unable_to_complete', 'cancelled')),
          1
        )
      end
      from public.care_tasks
      where organisation_id = p_org and updated_at >= now() - interval '30 days'
    ),

    'tasks_overdue_now', (
      select count(*) from public.care_tasks
      where organisation_id = p_org and status = 'missed'
    ),

    'tasks_high_priority_overdue', (
      select count(*) from public.care_tasks
      where organisation_id = p_org and status = 'missed' and priority = 1
    ),

    'care_task_escalations_30d', (
      select count(*) from public.care_tasks
      where organisation_id = p_org
        and escalation_stage = 'clinical_review'
        and updated_at >= now() - interval '30 days'
    ),

    'goals_achieved_30d', (
      select count(*) from public.care_plan_goals
      where organisation_id = p_org and status = 'achieved' and updated_at >= now() - interval '30 days'
    ),

    'goals_active', (
      select count(*) from public.care_plan_goals
      where organisation_id = p_org and status = 'open'
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.care_management_kpis(uuid) from public, anon;
grant execute on function public.care_management_kpis(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.care_management_kpis(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.care_management_kpis';
  end if;
  if not has_function_privilege('authenticated', 'public.care_management_kpis(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.care_management_kpis';
  end if;
  raise notice 'PASS: anon denied, authenticated allowed on care_management_kpis';
end $$;
