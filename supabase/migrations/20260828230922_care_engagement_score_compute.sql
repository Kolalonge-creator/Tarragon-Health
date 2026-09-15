-- Patient Engagement Engine, step 4: the nightly compute.
--
-- Every dimension below is derived read-only from tables that already exist and are
-- already the platform's source of truth for that behaviour — no parallel tracking
-- table is introduced (matches the wearables/vitals "no dual source of truth" rule).
-- Nulls propagate deliberately: a dimension that doesn't apply to a given patient
-- (e.g. no medications prescribed, no open care-plan goals) is excluded from that
-- patient's composite average rather than counted against them.
--
-- 'unreachable' is the one exception to "score drives level": it means outbound
-- contact itself is failing (attempts made, none landed, and the patient hasn't used
-- the app either) — a communications problem, not a motivation problem — so it can
-- fire even for a patient with no other dimension data at all.
create or replace function private.compute_care_engagement_scores()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_computed_at timestamptz := now();
begin
  with candidates as (
    select p.id as patient_id, p.organisation_id
    from public.profiles p
    where p.role = 'patient'
      and p.receives_care is distinct from false
  ),
  monitoring as (
    select v.patient_id,
      least(100, round(count(distinct date_trunc('week', v.taken_at)) / 8.0 * 100, 2)) as score
    from public.vitals_readings v
    where v.taken_at >= v_computed_at - interval '56 days'
    group by v.patient_id
  ),
  appointment_attendance as (
    select a.patient_id,
      round(
        count(*) filter (where a.status = 'completed')::numeric
        / nullif(count(*) filter (where a.status in ('completed', 'no_show')), 0) * 100, 2
      ) as score
    from public.appointments a
    where a.scheduled_for >= v_computed_at - interval '180 days'
    group by a.patient_id
  ),
  medication_checkin_rate as (
    select mac.patient_id,
      round(
        count(*) filter (where mac.status = 'responded')::numeric
        / nullif(count(*), 0) * 100, 2
      ) as raw_score
    from public.medication_adherence_checkins mac
    where mac.due_date >= (v_computed_at - interval '90 days')::date
    group by mac.patient_id
  ),
  -- An open medication_adherence_alert means the existing escalation trigger already
  -- flagged trouble (>=3 missed doses in 30d => coach, >=6 => doctor); cap the
  -- checkin-response rate so a patient can't look fine on "did you respond to the
  -- checkin" while actively missing doses.
  medication_alert_cap as (
    select maa.patient_id, min(case maa.level when 'doctor' then 40 when 'coach' then 70 end) as cap
    from public.medication_adherence_alerts maa
    where maa.status <> 'resolved'
    group by maa.patient_id
  ),
  medication as (
    select r.patient_id, least(r.raw_score, coalesce(c.cap, 100)) as score
    from medication_checkin_rate r
    left join medication_alert_cap c on c.patient_id = r.patient_id
  ),
  lifestyle_events as (
    select patient_id, taken_at as occurred_at from public.lpe_measurements
    union all
    select patient_id, created_at from public.wellness_points_ledger
    union all
    select patient_id, logged_at from public.activity_log_entries
  ),
  lifestyle as (
    select patient_id,
      least(100, round(count(distinct date_trunc('week', occurred_at)) / 8.0 * 100, 2)) as score
    from lifestyle_events
    where occurred_at >= v_computed_at - interval '56 days'
    group by patient_id
  ),
  preventive_schedules as (
    select patient_id, status, due_date from public.screening_schedules
    union all
    select patient_id, status, due_date from public.vaccination_schedules
  ),
  prevention as (
    select patient_id,
      round(
        count(*) filter (where status = 'completed')::numeric
        / nullif(count(*) filter (where due_date <= v_computed_at::date), 0) * 100, 2
      ) as score
    from preventive_schedules
    group by patient_id
  ),
  app_usage as (
    select patient_id,
      least(100, round(count(distinct occurred_at::date) / 14.0 * 100, 2)) as score,
      count(distinct occurred_at::date) as active_days
    from private.patient_engagement_events()
    where occurred_at >= v_computed_at - interval '14 days'
    group by patient_id
  ),
  -- care_messages has no read-receipt column anywhere in the schema, so "response to
  -- messages" is approximated as: is there an open thread whose most recent message
  -- is from the care team and has sat unanswered for 5+ days? Each such stalled
  -- thread costs 20 points, floor 0.
  thread_status as (
    select cmt.patient_id, cmt.id as thread_id,
      last_msg.author_role as last_author_role,
      last_msg.created_at as last_message_at
    from public.care_message_threads cmt
    join lateral (
      select cm.author_role, cm.created_at
      from public.care_messages cm
      where cm.thread_id = cmt.id
      order by cm.created_at desc
      limit 1
    ) last_msg on true
    where cmt.status = 'open'
  ),
  message_responsiveness as (
    select patient_id,
      greatest(0, 100 - count(*) filter (
        where last_author_role = 'care_team' and last_message_at < v_computed_at - interval '5 days'
      ) * 20) as score
    from thread_status
    group by patient_id
  ),
  care_plan_completion as (
    select cpg.patient_id,
      round(
        count(*) filter (where cpg.status = 'achieved')::numeric
        / nullif(count(*) filter (where cpg.status in ('achieved', 'open')), 0) * 100, 2
      ) as score
    from public.care_plan_goals cpg
    join public.care_plans cp on cp.id = cpg.care_plan_id
    where cp.status in ('active', 'completed', 'paused', 'discharged')
    group by cpg.patient_id
  ),
  reachability as (
    select c.patient_id,
      exists (
        select 1 from public.notifications n
        where n.recipient_id = c.patient_id
          and n.created_at >= v_computed_at - interval '60 days'
          and (n.status in ('delivered', 'read') or n.delivered_at is not null or n.opened_at is not null)
      ) as had_successful_delivery,
      exists (
        select 1 from public.notifications n
        where n.recipient_id = c.patient_id and n.created_at >= v_computed_at - interval '60 days'
      ) as had_any_attempt
    from candidates c
  ),
  scored as (
    select
      c.patient_id, c.organisation_id,
      m.score as monitoring_adherence_score,
      aa.score as appointment_attendance_score,
      med.score as medication_adherence_score,
      l.score as lifestyle_score,
      pr.score as prevention_score,
      au.score as app_usage_score,
      mr.score as message_responsiveness_score,
      cpc.score as care_plan_completion_score,
      au.active_days,
      r.had_successful_delivery,
      r.had_any_attempt
    from candidates c
    left join monitoring m on m.patient_id = c.patient_id
    left join appointment_attendance aa on aa.patient_id = c.patient_id
    left join medication med on med.patient_id = c.patient_id
    left join lifestyle l on l.patient_id = c.patient_id
    left join prevention pr on pr.patient_id = c.patient_id
    left join app_usage au on au.patient_id = c.patient_id
    left join message_responsiveness mr on mr.patient_id = c.patient_id
    left join care_plan_completion cpc on cpc.patient_id = c.patient_id
    left join reachability r on r.patient_id = c.patient_id
  ),
  composite as (
    select s.*,
      (
        select round(avg(x), 2) from unnest(array[
          s.monitoring_adherence_score, s.appointment_attendance_score, s.medication_adherence_score,
          s.lifestyle_score, s.prevention_score, s.app_usage_score, s.message_responsiveness_score,
          s.care_plan_completion_score
        ]) as x where x is not null
      ) as computed_composite
    from scored s
  ),
  leveled as (
    select c.*,
      coalesce(c.computed_composite, 0) as final_composite,
      case
        when coalesce(c.active_days, 0) = 0 and c.had_any_attempt and not c.had_successful_delivery
          then 'unreachable'::public.care_engagement_level
        when coalesce(c.computed_composite, 0) >= 85 then 'highly_engaged'
        when coalesce(c.computed_composite, 0) >= 65 then 'engaged'
        when coalesce(c.computed_composite, 0) >= 40 then 'at_risk'
        else 'disengaged'
      end as engagement_level
    from composite c
    -- Skip a patient entirely this run only if they have neither any applicable
    -- dimension data NOR an unreachable signal — nothing meaningful to say yet.
    where c.computed_composite is not null
       or (coalesce(c.active_days, 0) = 0 and c.had_any_attempt and not c.had_successful_delivery)
  ),
  segmented as (
    select l.*,
      array_remove(array[
        case when l.app_usage_score is not null and l.app_usage_score >= 80
          and l.monitoring_adherence_score is not null and l.monitoring_adherence_score >= 80
          then 'highly_motivated'::public.patient_behavioral_segment end,
        case when l.engagement_level = 'at_risk' and coalesce(l.active_days, 0) > 0
          then 'needs_reminders'::public.patient_behavioral_segment end,
        case when l.monitoring_adherence_score is not null and l.medication_adherence_score is not null
          and abs(l.monitoring_adherence_score - l.medication_adherence_score) >= 40
          then 'inconsistent'::public.patient_behavioral_segment end,
        case when l.had_any_attempt and not l.had_successful_delivery
          then 'access_constrained'::public.patient_behavioral_segment end,
        case when coalesce(l.active_days, 0) = 0 and l.engagement_level <> 'unreachable'
          then 'digitally_disengaged'::public.patient_behavioral_segment end
      ], null) as segments
    from leveled l
  )
  insert into public.care_engagement_scores (
    organisation_id, patient_id, monitoring_adherence_score, appointment_attendance_score,
    medication_adherence_score, lifestyle_score, prevention_score, app_usage_score,
    message_responsiveness_score, care_plan_completion_score, composite_score,
    engagement_level, segments, inputs, computed_at
  )
  select
    s.organisation_id, s.patient_id, s.monitoring_adherence_score, s.appointment_attendance_score,
    s.medication_adherence_score, s.lifestyle_score, s.prevention_score, s.app_usage_score,
    s.message_responsiveness_score, s.care_plan_completion_score, s.final_composite,
    s.engagement_level, s.segments,
    jsonb_build_object(
      'active_days_14d', s.active_days,
      'had_successful_delivery_60d', s.had_successful_delivery,
      'had_any_notification_attempt_60d', s.had_any_attempt
    ),
    v_computed_at
  from segmented s;

  -- Milestones: recomputed as their own, independent statements (rather than reusing
  -- the CTEs above, which are scoped to the single statement they belong to) so each
  -- stays simple and directly auditable against its own source table.

  insert into public.patient_milestones (organisation_id, patient_id, milestone_type, detail, achieved_at)
  select v.organisation_id, v.patient_id, 'monitoring_streak_30d',
    jsonb_build_object('reading_days_30d', v.reading_days), v_computed_at
  from (
    select vr.organisation_id, vr.patient_id, count(distinct vr.taken_at::date) as reading_days
    from public.vitals_readings vr
    where vr.taken_at >= v_computed_at - interval '30 days'
    group by vr.organisation_id, vr.patient_id
  ) v
  where v.reading_days >= 20
    and not exists (
      select 1 from public.patient_milestones pm
      where pm.patient_id = v.patient_id and pm.milestone_type = 'monitoring_streak_30d'
        and pm.achieved_at >= v_computed_at - interval '30 days'
    );

  insert into public.patient_milestones (organisation_id, patient_id, milestone_type, detail, achieved_at)
  select m.organisation_id, m.patient_id, 'medication_adherence_90pct_month',
    jsonb_build_object('responded', m.responded, 'total', m.total), v_computed_at
  from (
    select mac.organisation_id, mac.patient_id,
      count(*) filter (where mac.status = 'responded') as responded,
      count(*) as total
    from public.medication_adherence_checkins mac
    where mac.due_date >= (v_computed_at - interval '30 days')::date
    group by mac.organisation_id, mac.patient_id
  ) m
  where m.total >= 3
    and (m.responded::numeric / m.total) >= 0.9
    and not exists (
      select 1 from public.patient_milestones pm
      where pm.patient_id = m.patient_id and pm.milestone_type = 'medication_adherence_90pct_month'
        and pm.achieved_at >= v_computed_at - interval '30 days'
    );

  insert into public.patient_milestones (organisation_id, patient_id, milestone_type, detail, achieved_at)
  select ss.organisation_id, ss.patient_id, 'preventive_assessment_completed',
    jsonb_build_object('schedule_id', ss.id, 'schedule_table', 'screening_schedules'), v_computed_at
  from public.screening_schedules ss
  where ss.status = 'completed'
    and ss.updated_at >= v_computed_at - interval '1 day'
    and not exists (
      select 1 from public.patient_milestones pm
      where pm.patient_id = ss.patient_id and pm.milestone_type = 'preventive_assessment_completed'
        and (pm.detail ->> 'schedule_id')::uuid = ss.id
    );

  insert into public.patient_milestones (organisation_id, patient_id, milestone_type, detail, achieved_at)
  select vs.organisation_id, vs.patient_id, 'preventive_assessment_completed',
    jsonb_build_object('schedule_id', vs.id, 'schedule_table', 'vaccination_schedules'), v_computed_at
  from public.vaccination_schedules vs
  where vs.status = 'completed'
    and vs.updated_at >= v_computed_at - interval '1 day'
    and not exists (
      select 1 from public.patient_milestones pm
      where pm.patient_id = vs.patient_id and pm.milestone_type = 'preventive_assessment_completed'
        and (pm.detail ->> 'schedule_id')::uuid = vs.id
    );

  insert into public.patient_milestones (organisation_id, patient_id, milestone_type, detail, achieved_at)
  select g.organisation_id, g.patient_id, 'patient_goal_achieved',
    jsonb_build_object('goal_id', g.id, 'goal_type', g.goal_type, 'description', g.description), v_computed_at
  from public.patient_goals g
  where g.status = 'achieved'
    and g.achieved_at >= v_computed_at - interval '1 day'
    and not exists (
      select 1 from public.patient_milestones pm
      where pm.patient_id = g.patient_id and pm.milestone_type = 'patient_goal_achieved'
        and (pm.detail ->> 'goal_id')::uuid = g.id
    );

  insert into public.patient_milestones (organisation_id, patient_id, milestone_type, detail, achieved_at)
  select cur.organisation_id, cur.patient_id, 'engagement_recovery',
    jsonb_build_object('from_level', prev.engagement_level, 'to_level', cur.engagement_level), v_computed_at
  from public.care_engagement_scores cur
  join lateral (
    select ces.engagement_level
    from public.care_engagement_scores ces
    where ces.patient_id = cur.patient_id and ces.computed_at < v_computed_at
    order by ces.computed_at desc
    limit 1
  ) prev on true
  where cur.computed_at = v_computed_at
    and prev.engagement_level in ('at_risk', 'disengaged', 'unreachable')
    and cur.engagement_level in ('engaged', 'highly_engaged');
end;
$$;

revoke all on function private.compute_care_engagement_scores() from public, anon;

select cron.schedule(
  'care-engagement-score-nightly',
  '0 6 * * *',
  $$select private.compute_care_engagement_scores();$$
);

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'compute_care_engagement_scores'
  ) then
    raise exception 'private.compute_care_engagement_scores() missing after migration';
  end if;

  if not exists (select 1 from cron.job where jobname = 'care-engagement-score-nightly') then
    raise exception 'care-engagement-score-nightly cron job missing after migration';
  end if;
end $$;
