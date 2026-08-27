-- Tarragon Health — Care Management Engine, step 10b
--
-- Adds the last two of §3.13's six exception types to the same worklist
-- every other one already lands on: missed appointments
-- (appointments.status = 'no_show') and failed referrals
-- (specialist_referrals.status = 'declined'). Both are windowed to a recent
-- period (14 / 30 days) rather than matched unconditionally — unlike
-- care_tasks, neither appointments nor specialist_referrals has a further
-- state transition once it lands on 'no_show'/'declined', so an unbounded
-- match would re-surface the same old row forever even after a coordinator
-- resolves the outreach task for it (patient_care_gaps' existing branches
-- all close on a real state change elsewhere — e.g. a new active care plan
-- for unactioned_abnormal — which neither of these has).
--
-- Everything else in the function body is preserved byte-for-byte from the
-- live definition (20260827090600), same discipline this codebase already
-- applies to every queue_care_outreach edit.

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

    union all

    -- Missed appointments — windowed to the last 14 days so an old no-show
    -- doesn't re-surface forever once a coordinator has already dealt with it.
    select
      a.organisation_id,
      a.patient_id,
      'missed_appointment'::public.outreach_trigger_type,
      jsonb_build_object(
        'appointment_id', a.id, 'scheduled_for', a.scheduled_for, 'reason', a.reason
      ),
      2
    from public.appointments a
    where a.status = 'no_show'
      and a.updated_at >= now() - interval '14 days'

    union all

    -- Failed (declined) specialist referrals — windowed to the last 30 days
    -- for the same reason. 'declined' is the closest real status this
    -- codebase has to "failed": see the migration header for why no new
    -- enum value was added to specialist_referrals for this.
    select
      sr.organisation_id,
      sr.patient_id,
      'failed_referral'::public.outreach_trigger_type,
      jsonb_build_object(
        'referral_id', sr.id, 'specialist_type', sr.specialist_type, 'reason', sr.referral_reason
      ),
      2
    from public.specialist_referrals sr
    where sr.status = 'declined'
      and sr.updated_at >= now() - interval '30 days'
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
-- Assertion — the migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname = 'queue_care_outreach' and pronamespace = 'private'::regnamespace;

  if v_def not like '%missed_appointment%' then
    raise exception 'FAIL: queue_care_outreach is missing the missed_appointment branch';
  end if;
  if v_def not like '%failed_referral%' then
    raise exception 'FAIL: queue_care_outreach is missing the failed_referral branch';
  end if;
  -- Every pre-existing branch must survive this rewrite.
  if v_def not like '%missed_care_task%'
     or v_def not like '%high_risk_score%'
     or v_def not like '%unactioned_abnormal%' then
    raise exception 'FAIL: queue_care_outreach lost a pre-existing branch';
  end if;

  raise notice 'PASS: queue_care_outreach covers missed_appointment and failed_referral, prior branches intact';
end $$;
