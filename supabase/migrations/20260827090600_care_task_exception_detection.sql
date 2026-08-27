-- Tarragon Health — Care Management Engine, step 6b
--
-- Two closely related additions, kept in one migration because the second
-- depends on the enum value the previous (standalone) migration just added:
--
-- 1. private.queue_care_outreach() gains a 'missed_care_task' branch, so a
--    task nobody completed surfaces on the SAME coordinator worklist as
--    every other exception type, instead of a new one nobody would think to
--    check. Everything else in the function body is preserved byte-for-byte
--    from the live definition (pulled from 20260803125639), same discipline
--    this codebase already applies to every queue_care_outreach edit.
--
-- 2. private.escalate_overdue_care_tasks() — the task-level escalation chain
--    spec §3.14 describes: "Task due -> No completion -> Reminder -> Still
--    incomplete -> Care coordinator -> Clinical review if necessary. The
--    exact timing is configurable." Timing lives in escalation_slas
--    (config, not code — same table, same discipline as every other
--    pathway in it), added here as a new unsigned draft version per this
--    table's own established pattern (20260807090456, 20260810033834):
--    carry the current active config forward unchanged, append the new
--    pathway, deactivate the old version, leave approved_by/approved_at
--    null for a Clinical Director to review at /admin/settings/escalation-slas.
--
--    "Still incomplete -> care coordinator" is deliberately NOT a second
--    timed stage here: the moment a task's status flips to 'missed' it is
--    already visible on the coordinator's outreach worklist via (1) above —
--    there is no reason to make a coordinator wait for a grace period a
--    doctor's SLA clock needs but a logistics worklist does not. Only the
--    "-> clinical review if necessary" step is gated on a grace period, and
--    only for priority-1 tasks — a missed routine weekly weigh-in does not
--    need a doctor, which is the entire reason care_tasks.priority exists.

create or replace function private.queue_care_outreach()
returns void
language sql
security definer
set search_path to ''
as $function$
  with latest_risk as (
    select distinct on (prs.patient_id)
      prs.patient_id, prs.organisation_id, prs.risk_level, prs.score_type,
      prs.id as score_id, prs.computed_at
    from public.patient_risk_scores prs
    where prs.computed_at >= now() - interval '120 days'
    order by prs.patient_id, prs.computed_at desc
  ),
  candidates as (
    -- High/very-high latest risk score → priority 1/2.
    select
      lr.organisation_id,
      lr.patient_id,
      'high_risk_score'::public.outreach_trigger_type as trigger_type,
      jsonb_build_object(
        'risk_level', lr.risk_level,
        'score_type', lr.score_type,
        'score_id', lr.score_id,
        'computed_at', lr.computed_at
      ) as trigger_detail,
      case when lr.risk_level = 'very_high' then 1 else 2 end as priority
    from latest_risk lr
    where lr.risk_level in ('high', 'very_high')

    union all

    -- Open care gaps (derived view; recomputed live each run).
    select
      g.organisation_id,
      g.patient_id,
      case g.gap_type
        when 'unactioned_abnormal' then 'unactioned_abnormal'
        when 'overdue_screening' then 'overdue_screening'
        when 'awaiting_result' then 'awaiting_result'
        else 'stale_monitoring'
      end::public.outreach_trigger_type,
      g.detail || jsonb_build_object('condition_or_type', g.condition_or_type, 'opened_at', g.opened_at),
      case g.gap_type
        when 'unactioned_abnormal' then 1
        when 'overdue_screening' then 2
        when 'awaiting_result' then 2
        else 3
      end
    from public.patient_care_gaps g

    union all

    -- Care-plan tasks nobody completed by their due date (§3.13's "missed
    -- monitoring" / "non-adherence" exception types, for the first time
    -- backed by a real task rather than only a domain-specific table).
    select
      ct.organisation_id,
      ct.patient_id,
      'missed_care_task'::public.outreach_trigger_type,
      jsonb_build_object('task_id', ct.id, 'title', ct.title, 'status', ct.status, 'due_at', ct.due_at),
      case when ct.priority = 1 then 1 else 2 end
    from public.care_tasks ct
    where ct.status in ('missed', 'expired', 'unable_to_complete')
  ),
  inserted as (
    -- nudge_sent_at is stamped at insert because the nudge below is enqueued
    -- for every newly inserted task's patient in this same transaction. (A
    -- post-hoc UPDATE can't work here: data-modifying CTEs share one snapshot,
    -- so a sibling statement never sees the rows this INSERT creates.)
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority, nudge_sent_at)
    select organisation_id, patient_id, trigger_type, trigger_detail, priority, now()
    from candidates
    on conflict (patient_id, trigger_type)
      where status in ('open', 'in_progress', 'contacted')
      do nothing
    returning id, organisation_id, patient_id, trigger_type
  )
  -- One aggregated, warm nudge per patient per run — only when something NEW
  -- surfaced (re-runs insert nothing, so nobody is re-nudged nightly).
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    i.organisation_id,
    i.patient_id,
    'whatsapp',
    'pending',
    'care_outreach_checkin',
    jsonb_build_object('reasons', array_agg(distinct i.trigger_type::text))
  from inserted i
  group by i.organisation_id, i.patient_id;
$function$;

-- ---------------------------------------------------------------------------
-- escalation_slas — new 'care_task_overdue' pathway, unsigned draft.
-- ---------------------------------------------------------------------------
insert into public.escalation_slas (version, config, notes, is_active)
select
  (select coalesce(max(version), 0) + 1 from public.escalation_slas),
  active.config || '[
    {"pathway": "care_task_overdue", "tier": "routine", "sla_minutes": 2880, "channel_sequence": ["push, batched"], "source_function": "private.escalate_overdue_care_tasks", "note": "Grace period after a PRIORITY-1 care task is marked missed before it is escalated to a clinician_alerts row. Priority 2/3 missed tasks never reach this stage at all — a missed routine weigh-in does not need a doctor."},
    {"pathway": "care_task_overdue", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.escalate_overdue_care_tasks", "note": "Contact SLA on the clinician_alerts row raised for a still-unresolved priority-1 missed care task."}
  ]'::jsonb,
  'Adds care_task_overdue (Care Management Engine §3.14) — the grace period before an unresolved priority-1 missed task reaches a clinician, and that resulting alert''s own contact SLA. Both figures chosen only by consistency with this table''s existing clinician_review-tier entries (bp/lpe/chronic_monitoring_silence all use 4320min); no clinical sign-off yet. DRAFT, unsigned — flag for Clinical Director review alongside the rest of this table.',
  true
from public.escalation_slas active
where active.is_active;

update public.escalation_slas set is_active = false
where is_active
  and version <> (select max(version) from public.escalation_slas);

-- ---------------------------------------------------------------------------
-- private.escalate_overdue_care_tasks() — the task-level escalation engine.
-- Two independent stages, each idempotent on escalation_stage so a nightly
-- re-run never re-fires a stage a task already passed:
--
--   1. due date passed, nobody has been told yet -> mark 'missed', remind
--      the task's owner (in-app; WhatsApp/SMS stays notification-layer only
--      per CLAUDE.md), stage -> 'reminded'. (Coordinator visibility is
--      immediate and separate — see (1) above, not gated here.)
--   2. still missed after the configured grace period AND priority = 1 ->
--      raise a clinician_alerts row (same worklist every other clinical
--      escalation in this codebase lands on), stage -> 'clinical_review'.
-- ---------------------------------------------------------------------------
create or replace function private.escalate_overdue_care_tasks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grace_minutes integer;
  v_sla_minutes   integer;
  v_task          record;
begin
  -- Stage 1: due and untouched -> missed + reminder.
  for v_task in
    select * from public.care_tasks
    where status in ('not_started', 'scheduled', 'in_progress')
      and escalation_stage = 'none'
      and due_at is not null
      and due_at < now()
  loop
    update public.care_tasks
      set status = 'missed', escalation_stage = 'reminded'
      where id = v_task.id;

    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      v_task.organisation_id,
      coalesce(v_task.owner_id, v_task.patient_id),
      'in_app',
      'pending',
      'care_task_overdue_reminder',
      jsonb_build_object('task_id', v_task.id, 'title', v_task.title, 'due_at', v_task.due_at)
    );
  end loop;

  -- Stage 2: still missed, priority 1, past the configured grace period ->
  -- a clinician needs to see this, not just a coordinator.
  v_grace_minutes := private.escalation_sla_minutes('care_task_overdue', 'routine');
  v_sla_minutes := private.escalation_sla_minutes('care_task_overdue', 'clinician_review');

  for v_task in
    select * from public.care_tasks
    where status = 'missed'
      and escalation_stage = 'reminded'
      and priority = 1
      and due_at < now() - (v_grace_minutes || ' minutes')::interval
  loop
    update public.care_tasks
      set escalation_stage = 'clinical_review'
      where id = v_task.id;

    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at)
    values (
      v_task.organisation_id,
      v_task.patient_id,
      'clinician_review',
      'open',
      'Overdue priority care task needs review',
      format('"%s" was due %s and is still not complete.', v_task.title, to_char(v_task.due_at, 'YYYY-MM-DD HH24:MI')),
      now() + (v_sla_minutes || ' minutes')::interval
    );
  end loop;

  -- Long-stale, never-started, one-off tasks close as expired rather than
  -- sitting missed forever (§3.8's 'Expired' status). Recurring tasks are
  -- excluded — the roll trigger already regenerates their next occurrence
  -- the moment this same update marks one missed.
  update public.care_tasks
    set status = 'expired'
    where status = 'missed'
      and recurrence is null
      and due_at < now() - interval '30 days';
end;
$$;

select cron.schedule(
  'care-task-escalation-daily',
  '15 6 * * *',
  $$select private.escalate_overdue_care_tasks();$$
);

-- ---------------------------------------------------------------------------
-- Assertions — the migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_val integer;
begin
  v_val := private.escalation_sla_minutes('care_task_overdue', 'routine');
  if v_val <> 2880 then raise exception 'FAIL: care_task_overdue/routine = % (expected 2880)', v_val; end if;

  v_val := private.escalation_sla_minutes('care_task_overdue', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: care_task_overdue/clinician_review = % (expected 4320)', v_val; end if;

  -- A pre-existing pathway must still resolve — the config carry-forward
  -- (active.config || ...) must not have dropped anything.
  v_val := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: bp_vitals_red_flag/urgent_escalation = % (expected 60, config not carried forward correctly)', v_val; end if;

  if (select count(*) from public.escalation_slas where is_active) <> 1 then
    raise exception 'FAIL: expected exactly one active escalation_slas version';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'escalate_overdue_care_tasks'
      and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'FAIL: private.escalate_overdue_care_tasks() was not created';
  end if;

  raise notice 'PASS: care_task_overdue registered, escalate_overdue_care_tasks() wired, exactly one active escalation_slas version';
end $$;
