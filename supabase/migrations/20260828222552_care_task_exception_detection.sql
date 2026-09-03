-- Tarragon Health — Care Management Engine, step 6b
--
-- Originally two closely related additions in one migration: a
-- 'missed_care_task' branch on private.queue_care_outreach(), plus the
-- task-level escalation chain below. The queue_care_outreach() piece was
-- pulled out during integration with main-dev: two OTHER concurrent
-- sessions (Consultation System's repeated_no_show branch, and this
-- feature's own missed_appointment/failed_referral branches two migrations
-- later) each independently rewrote the same live function, and a third
-- rewrite here that didn't know about either would silently drop whichever
-- branch it overwrote. The final, single reconciled version carrying EVERY
-- branch (this one's missed_care_task included) lives in
-- 20260827100100_care_outreach_appointments_and_referrals.sql instead,
-- applied once all three sources of truth are known.
--
-- private.escalate_overdue_care_tasks() — the task-level escalation chain
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
