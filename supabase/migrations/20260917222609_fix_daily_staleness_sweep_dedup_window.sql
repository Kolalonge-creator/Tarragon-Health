-- Found during a doctor-side platform audit 2026-09-17: the three daily
-- staleness-sweep alert generators from 20260828204149 (overdue_task,
-- laboratory_failure, pharmacy_problem) each guard against re-raising a
-- fresh clinician_alerts row with `ca.created_at > now() - interval '20
-- hours'`, but all three crons run once a DAY ('15 3 * * *', '30 3 * * *',
-- '45 3 * * *' -- 24h apart). Since 24h > 20h, by the time tomorrow's run
-- fires, yesterday's alert has already aged out of the 20h window, so the
-- guard never actually blocks anything after the first day: a
-- care_outreach_tasks/lab_orders/pharmacy_orders row that stays stuck
-- generates a brand-new duplicate alert EVERY single day it remains open,
-- exactly the alert-fatigue outcome the surrounding migration's own comment
-- says this guard exists to prevent ("a daily sweep re-running while the
-- underlying condition is still true should not regenerate a fresh alert
-- every single run"). Confirmed live before this fix: 109 open/acknowledged
-- overdue_task rows across only 9 patients, 30 laboratory_failure rows
-- across 1 patient -- one still-open condition each, repeated daily.
-- alert_rules carries no governed config for any of these three type_codes
-- (confirmed live, config->'overdue_task' etc. all null), so
-- classify_and_assign_clinician_alert's own auto_suppress_duplicates path
-- never engages either -- this local not-exists guard was the only defence,
-- and it was broken.
--
-- Fix: drop the time bound entirely and dedupe purely on "an open or
-- acknowledged alert of this type already exists for this patient" -- the
-- correct semantics for a staleness sweep on a condition that persists
-- (task/order still stuck): don't re-alert while a prior alert for the same
-- condition is still unresolved; once a doctor resolves or closes it, a
-- fresh sweep raising a new alert (if the underlying row is still stuck) is
-- the intended re-escalation, not a bug.

create or replace function private.raise_overdue_task_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    cot.organisation_id, cot.patient_id, 'routine',
    'Overdue care-coordination task',
    format('Outreach task (%s) has been open since %s with no follow-up recorded.', cot.trigger_type, to_char(cot.created_at, 'YYYY-MM-DD')),
    'care_management', 'overdue_task'
  )
  from public.care_outreach_tasks cot
  where cot.status = 'open'
    and cot.nudge_sent_at is null
    and cot.created_at < now() - interval '72 hours'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'overdue_task' and ca.patient_id = cot.patient_id
        and ca.status in ('open', 'acknowledged')
    );
end;
$$;

comment on function private.raise_overdue_task_alerts() is
  'Daily sweep: a care_outreach_tasks row still open, un-nudged, 72h+ old raises a routine clinician_alerts row (8.1 overdue_task) so a stalled coordination task gets supervisory visibility beyond the coordinator worklist alone. Dedup is a plain "no open/acknowledged alert of this type for this patient already exists" check (fixed 2026-09-17 -- see this migration''s header for why a 20h time-bound guard against a 24h cron duplicated daily).';

create or replace function private.raise_laboratory_failure_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    lo.organisation_id, lo.patient_id, 'clinician_review',
    'Lab order stalled before sample collection',
    format('Lab order %s has been in "ordered" status since %s with no sample collected.', coalesce(lo.order_number, lo.id::text), to_char(lo.ordered_at, 'YYYY-MM-DD')),
    'operational', 'laboratory_failure'
  )
  from public.lab_orders lo
  where lo.status = 'ordered'
    and lo.ordered_at < now() - interval '5 days'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'laboratory_failure' and ca.patient_id = lo.patient_id
        and ca.status in ('open', 'acknowledged')
    );
end;
$$;

comment on function private.raise_laboratory_failure_alerts() is
  'Daily sweep: a lab_orders row stuck in ordered status 5d+ with no sample_collected transition raises a clinician_review clinician_alerts row (8.1 laboratory_failure). Dedup is a plain "no open/acknowledged alert of this type for this patient already exists" check (fixed 2026-09-17, see raise_overdue_task_alerts comment).';

create or replace function private.raise_pharmacy_problem_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    po.organisation_id, po.patient_id, 'clinician_review',
    'Pharmacy order stalled before dispensing',
    format('Pharmacy order %s has been "%s" since %s without progressing to dispensed.', coalesce(po.order_number, po.id::text), po.status, to_char(po.requested_at, 'YYYY-MM-DD')),
    'medication', 'pharmacy_problem'
  )
  from public.pharmacy_orders po
  where po.status in ('requested', 'confirmed')
    and po.requested_at < now() - interval '3 days'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'pharmacy_problem' and ca.patient_id = po.patient_id
        and ca.status in ('open', 'acknowledged')
    );
end;
$$;

comment on function private.raise_pharmacy_problem_alerts() is
  'Daily sweep: a pharmacy_orders row stuck requested/confirmed 3d+ without reaching dispensed raises a clinician_review clinician_alerts row (8.1 pharmacy_problem). Dedup is a plain "no open/acknowledged alert of this type for this patient already exists" check (fixed 2026-09-17, see raise_overdue_task_alerts comment).';

revoke all on function private.raise_overdue_task_alerts() from public, anon;
revoke all on function private.raise_laboratory_failure_alerts() from public, anon;
revoke all on function private.raise_pharmacy_problem_alerts() from public, anon;

-- Clean up the duplicate noise these three generators already produced:
-- keep only the single most-recent open/acknowledged alert per
-- (patient_id, type_code) among the three affected type_codes, and close
-- the rest out as explicit duplicates (never delete -- audit trail stays
-- intact, matching this platform's "never deprioritise or silently swallow"
-- discipline; these were real generated alerts, just redundant ones).
with ranked as (
  select
    id,
    row_number() over (
      partition by patient_id, type_code
      order by created_at desc
    ) as rn
  from public.clinician_alerts
  where type_code in ('overdue_task', 'laboratory_failure', 'pharmacy_problem')
    and status in ('open', 'acknowledged')
)
update public.clinician_alerts ca
set status = 'resolved',
    resolution_outcome = 'duplicate',
    resolution_action = 'Auto-closed 2026-09-17: superseded by a more recent alert of the same type for this patient, generated by the same still-open condition. Root cause (a dedup window shorter than the daily cron interval) fixed in this migration; see clinician_alerts.duplicate_of / dedup_key for the surviving alert.',
    resolved_at = now()
from ranked
where ca.id = ranked.id
  and ranked.rn > 1;

do $$
declare
  v_leftover_dupes int;
begin
  if pg_get_functiondef('private.raise_overdue_task_alerts()'::regprocedure) ilike '%20 hours%' then
    raise exception 'FAIL: raise_overdue_task_alerts still has the broken 20h dedup window';
  end if;
  if pg_get_functiondef('private.raise_laboratory_failure_alerts()'::regprocedure) ilike '%20 hours%' then
    raise exception 'FAIL: raise_laboratory_failure_alerts still has the broken 20h dedup window';
  end if;
  if pg_get_functiondef('private.raise_pharmacy_problem_alerts()'::regprocedure) ilike '%20 hours%' then
    raise exception 'FAIL: raise_pharmacy_problem_alerts still has the broken 20h dedup window';
  end if;

  select count(*) into v_leftover_dupes
  from (
    select patient_id, type_code, count(*) as c
    from public.clinician_alerts
    where type_code in ('overdue_task', 'laboratory_failure', 'pharmacy_problem')
      and status in ('open', 'acknowledged')
    group by patient_id, type_code
    having count(*) > 1
  ) x;
  if v_leftover_dupes > 0 then
    raise exception 'FAIL: % (patient_id, type_code) pairs still have more than one open/acknowledged alert', v_leftover_dupes;
  end if;

  raise notice 'PASS: all three staleness sweeps dedupe on status alone (no time-bound gap), existing duplicate alerts closed out as duplicate';
end $$;
