-- Patient Engagement Engine, step 5b: walk the disengagement recovery ladder.
--
-- Reads only the latest care_engagement_scores row per patient plus how many of the
-- last 14 days' runs were low-engagement, and escalates accordingly:
--   1 low reading, at_risk        -> personalized in-app reminder
--   3+ low readings                -> support-message offer (simpler routine, help)
--   5+ low readings, disengaged,
--   or unreachable                 -> care_outreach_tasks (existing coordinator worklist)
--   unreachable                    -> also try a channel other than the stated preference
--   disengaged/unreachable
--   + high/very_high clinical risk -> clinical_review_flag log entry (see the prior
--                                      migration's header for why this doesn't
--                                      auto-create a clinician_alerts row)
-- Every send is deduplicated against patient_engagement_interventions so a patient
-- who stays at_risk for a week gets the escalating sequence once, not the same
-- message every night.
--
-- Channel-enabled gating: reconciled against main-dev's own
-- patient_notification_preferences (20260829222502), built independently while this
-- branch was in flight — that table already gates every routine template by
-- category via TEMPLATE_CATEGORY in send-pending-notifications/index.ts, so the
-- three new templates below are simply registered there (mapped to
-- "education_wellness", the same bucket vitals_reminder/lifestyle_nudge already use)
-- rather than this migration inventing a second, parallel preferences table/gate —
-- see the reconciliation notes on this branch for the full reasoning. This
-- migration therefore inserts unconditionally, same as every other nightly
-- reminder cron in this codebase (care-outreach-daily,
-- medication-checkin-reminders-daily, ...); the existing send pipeline is what
-- decides whether the send actually goes out.
--
-- Channel preference: "alternative channel" (step 4) reads
-- profiles.notification_channel_preference (already shipped,
-- 20260830002321_communication_preferences_columns.sql) rather than a new column,
-- so there is exactly one place a patient's preferred routine-notification channel
-- lives.
create or replace function private.queue_engagement_interventions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  create temporary table tmp_engagement_candidates on commit drop as
  with latest as (
    select distinct on (ces.patient_id)
      ces.patient_id, ces.organisation_id, ces.engagement_level,
      ces.monitoring_adherence_score, ces.appointment_attendance_score, ces.medication_adherence_score,
      ces.lifestyle_score, ces.prevention_score, ces.app_usage_score, ces.message_responsiveness_score,
      ces.care_plan_completion_score
    from public.care_engagement_scores ces
    order by ces.patient_id, ces.computed_at desc
  ),
  repeat_counts as (
    select ces.patient_id,
      count(*) filter (where ces.engagement_level in ('at_risk', 'disengaged', 'unreachable')) as low_engagement_runs
    from public.care_engagement_scores ces
    where ces.computed_at >= v_now - interval '14 days'
    group by ces.patient_id
  ),
  risk as (
    select distinct on (prs.patient_id) prs.patient_id, prs.risk_level
    from public.patient_risk_scores prs
    where prs.computed_at >= v_now - interval '120 days'
    order by prs.patient_id, prs.computed_at desc
  ),
  preferred as (
    select p.id as patient_id, p.notification_channel_preference as preferred_channel
    from public.profiles p
  )
  select
    l.patient_id, l.organisation_id, l.engagement_level,
    coalesce(rc.low_engagement_runs, 1) as low_engagement_runs,
    r.risk_level,
    coalesce(p.preferred_channel, 'whatsapp'::public.notification_channel) as preferred_channel,
    (
      select dim.dimension_name
      from (values
        ('monitoring', l.monitoring_adherence_score),
        ('appointments', l.appointment_attendance_score),
        ('medication', l.medication_adherence_score),
        ('lifestyle', l.lifestyle_score),
        ('prevention', l.prevention_score),
        ('app_usage', l.app_usage_score),
        ('messages', l.message_responsiveness_score),
        ('care_plan', l.care_plan_completion_score)
      ) as dim(dimension_name, dimension_score)
      where dim.dimension_score is not null
      order by dim.dimension_score asc
      limit 1
    ) as lowest_dimension
  from latest l
  left join repeat_counts rc on rc.patient_id = l.patient_id
  left join risk r on r.patient_id = l.patient_id
  left join preferred p on p.patient_id = l.patient_id
  where l.engagement_level in ('at_risk', 'disengaged', 'unreachable');

  -- 1. First low-engagement reading -> personalized reminder. Covers both at_risk
  -- and disengaged: a patient can drop straight to disengaged on their very first
  -- low reading (a data-sparse composite, a bad week), and gating this purely on
  -- 'at_risk' would leave them waiting for rule 2's repeat-count threshold before
  -- hearing anything at all — the worse case getting a slower response than the
  -- milder one.
  with sent as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select c.organisation_id, c.patient_id, 'in_app', 'pending', 'engagement_reminder_personalized',
      jsonb_build_object('lowest_dimension', c.lowest_dimension), 'non_clinical'
    from tmp_engagement_candidates c
    where c.engagement_level in ('at_risk', 'disengaged') and c.low_engagement_runs = 1
      and not exists (
        select 1 from public.patient_engagement_interventions pei
        where pei.patient_id = c.patient_id and pei.intervention_type = 'reminder'
          and pei.created_at >= v_now - interval '3 days'
      )
    returning id as notification_id, recipient_id as patient_id, organisation_id
  )
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger, notification_id)
  select s.organisation_id, s.patient_id, 'missed_task', 'reminder', c.engagement_level, s.notification_id
  from sent s
  join tmp_engagement_candidates c on c.patient_id = s.patient_id;

  -- 2. Repeated low engagement (3+ low readings in the trailing 14 days) -> support
  -- message offering help rather than another bare reminder.
  with sent as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select c.organisation_id, c.patient_id, 'in_app', 'pending', 'engagement_support_offer',
      jsonb_build_object('lowest_dimension', c.lowest_dimension), 'non_clinical'
    from tmp_engagement_candidates c
    where c.engagement_level in ('at_risk', 'disengaged') and c.low_engagement_runs >= 3
      and not exists (
        select 1 from public.patient_engagement_interventions pei
        where pei.patient_id = c.patient_id and pei.intervention_type = 'support_message'
          and pei.created_at >= v_now - interval '7 days'
      )
    returning id as notification_id, recipient_id as patient_id, organisation_id
  )
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger, notification_id)
  select s.organisation_id, s.patient_id, 'repeated_missed_task', 'support_message', c.engagement_level, s.notification_id
  from sent s
  join tmp_engagement_candidates c on c.patient_id = s.patient_id;

  -- 3. Persistent non-engagement (5+ low readings, disengaged) or unreachable ->
  -- the existing care-coordinator worklist, priority pulled to 1 when clinical risk
  -- is also high.
  with sent as (
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority, nudge_sent_at)
    select c.organisation_id, c.patient_id, 'disengagement_risk'::public.outreach_trigger_type,
      jsonb_build_object('engagement_level', c.engagement_level, 'low_engagement_runs', c.low_engagement_runs),
      case when c.risk_level in ('high', 'very_high') then 1 else 2 end,
      v_now
    from tmp_engagement_candidates c
    where (c.engagement_level = 'disengaged' and c.low_engagement_runs >= 5) or c.engagement_level = 'unreachable'
    on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing
    returning id as outreach_task_id, patient_id, organisation_id
  )
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger, outreach_task_id)
  select s.organisation_id, s.patient_id, 'persistent_non_engagement', 'care_coordinator_outreach',
    c.engagement_level, s.outreach_task_id
  from sent s
  join tmp_engagement_candidates c on c.patient_id = s.patient_id;

  -- 4. Unreachable -> try a channel other than the patient's stated preference
  -- before assuming the whole recovery ladder has to run its full course.
  with sent as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select c.organisation_id, c.patient_id,
      case when c.preferred_channel = 'whatsapp' then 'sms' else 'whatsapp' end::public.notification_channel,
      'pending', 'engagement_alternative_channel_checkin',
      jsonb_build_object('reason', 'unreachable_on_preferred_channel'), 'non_clinical'
    from tmp_engagement_candidates c
    where c.engagement_level = 'unreachable'
      and not exists (
        select 1 from public.patient_engagement_interventions pei
        where pei.patient_id = c.patient_id and pei.intervention_type = 'alternative_channel'
          and pei.created_at >= v_now - interval '7 days'
      )
    returning id as notification_id, recipient_id as patient_id, organisation_id
  )
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger, notification_id)
  select organisation_id, patient_id, 'unreachable_on_preferred_channel', 'alternative_channel', 'unreachable', notification_id
  from sent;

  -- 5. High clinical risk + non-engagement -> explicit clinical-review flag (a log
  -- entry, not an automated clinician alert — see the prior migration's header).
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger)
  select c.organisation_id, c.patient_id, 'high_risk_non_engagement', 'clinical_review_flag', c.engagement_level
  from tmp_engagement_candidates c
  where c.engagement_level in ('disengaged', 'unreachable') and c.risk_level in ('high', 'very_high')
    and not exists (
      select 1 from public.patient_engagement_interventions pei
      where pei.patient_id = c.patient_id and pei.intervention_type = 'clinical_review_flag'
        and pei.created_at >= v_now - interval '7 days'
    );
end;
$$;

revoke all on function private.queue_engagement_interventions() from public, anon;

select cron.schedule(
  'engagement-interventions-nightly',
  '20 6 * * *',
  $$select private.queue_engagement_interventions();$$
);

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_engagement_interventions'
  ) then
    raise exception 'private.queue_engagement_interventions() missing after migration';
  end if;

  if not exists (select 1 from cron.job where jobname = 'engagement-interventions-nightly') then
    raise exception 'engagement-interventions-nightly cron job missing after migration';
  end if;
end $$;
