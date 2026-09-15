-- Tarragon Health — Specialist Referral Engine, escalation ladder for a
-- referral nobody has followed up on (task spec §11.12).
--
-- Confirmed before writing this: a specialist_referrals row that sits at
-- 'pending'/'waitlisted' (or any pre-outcome status) generates zero
-- escalation of any kind today, however long it sits there — there is no
-- equivalent of the staleness sweeps 20260828015618 already built for
-- care_outreach_tasks/lab_orders/pharmacy_orders. §11.12 describes exactly
-- this ladder: "If patient does not book: Reminder. If still not booked:
-- Care coordinator task. If referral is clinically important: Escalation to
-- appropriate clinical team." Self-arranged fulfilment (2026-08-03) means
-- Tarragon no longer tracks a specific booked appointment for most
-- referrals, so "did not book" is adapted here to its real equivalent in
-- the current model: a referral that has sat with no specialist outcome
-- recorded (neither treatment_plan_received_at nor the new
-- outcome_document_path) for an extended period. Reuses this codebase's own
-- established primitives throughout rather than inventing new ones:
-- private.raise_clinician_alert (added 20260828015618), the existing
-- care_outreach_tasks worklist + its live-dedup unique index, and the
-- existing failed_referral alert_type_code (already governed in
-- alert_rules — reused rather than adding a new type_code and its own
-- governance config row, since "referral stalled" and "referral declined"
-- are both, at heart, a referral failing to progress).

-- ---------------------------------------------------------------------------
-- 1. 14 days, no outcome yet -> patient reminder (in-app)
-- ---------------------------------------------------------------------------
create or replace function private.remind_patients_stale_referrals()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  select
    sr.organisation_id, sr.patient_id, 'in_app', 'referral_reminder',
    jsonb_build_object('referral_id', sr.id::text, 'specialist_type', sr.specialist_type)
  from public.specialist_referrals sr
  where sr.status not in ('closed', 'declined')
    and sr.treatment_plan_received_at is null
    and sr.outcome_document_path is null
    and sr.created_at < now() - interval '14 days'
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = sr.patient_id
        and n.template = 'referral_reminder'
        and n.payload ->> 'referral_id' = sr.id::text
        and n.created_at > now() - interval '13 days'
    );
end;
$$;

comment on function private.remind_patients_stale_referrals() is
  'Daily sweep: a specialist_referrals row 14d+ old with no outcome recorded yet gets an in-app reminder to see the specialist and bring back what they find (8.1-style staleness sweep, task spec §11.12 "Reminder"). Deduped by an explicit not-exists window since notifications has no per-source unique index to lean on.';

revoke all on function private.remind_patients_stale_referrals() from public, anon;

select cron.schedule('remind-patients-stale-referrals', '00 4 * * *', $$select private.remind_patients_stale_referrals()$$);

-- ---------------------------------------------------------------------------
-- 2. 30 days, still no outcome -> care coordinator task
-- ---------------------------------------------------------------------------
create or replace function private.raise_stale_referral_outreach_tasks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority)
  select
    sr.organisation_id, sr.patient_id, 'referral_follow_up',
    jsonb_build_object(
      'referral_id', sr.id::text,
      'specialist_type', sr.specialist_type,
      'referral_number', sr.referral_number,
      'created_at', sr.created_at
    ),
    case when sr.urgency in ('urgent', 'priority') then 1 else 2 end
  from public.specialist_referrals sr
  where sr.status not in ('closed', 'declined')
    and sr.treatment_plan_received_at is null
    and sr.outcome_document_path is null
    and sr.created_at < now() - interval '30 days'
  on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing;
end;
$$;

comment on function private.raise_stale_referral_outreach_tasks() is
  'Daily sweep: a specialist_referrals row 30d+ old with no outcome recorded raises a care_outreach_tasks row (referral_follow_up) so a coordinator calls the patient (task spec §11.12 "Care coordinator task"). Relies on care_outreach_tasks_live_unique for idempotency, same as the other outreach triggers.';

revoke all on function private.raise_stale_referral_outreach_tasks() from public, anon;

select cron.schedule('raise-stale-referral-outreach-tasks', '15 4 * * *', $$select private.raise_stale_referral_outreach_tasks()$$);

-- ---------------------------------------------------------------------------
-- 3. Urgent/priority, 7 days, still no outcome -> clinical escalation
-- ---------------------------------------------------------------------------
create or replace function private.raise_stale_urgent_referral_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    sr.organisation_id, sr.patient_id,
    case when sr.urgency = 'urgent' then 'urgent_escalation' else 'clinician_review' end,
    'Referral needs follow-up',
    format('A %s referral (%s) has had no specialist outcome recorded since %s.',
      sr.urgency, sr.specialist_type, to_char(sr.created_at, 'YYYY-MM-DD')),
    'care_management', 'failed_referral'
  )
  from public.specialist_referrals sr
  where sr.status not in ('closed', 'declined')
    and sr.urgency in ('urgent', 'priority')
    and sr.treatment_plan_received_at is null
    and sr.outcome_document_path is null
    and sr.created_at < now() - interval '7 days'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'failed_referral' and ca.patient_id = sr.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    );
end;
$$;

comment on function private.raise_stale_urgent_referral_alerts() is
  'Daily sweep: an urgent/priority specialist_referrals row 7d+ old with no outcome recorded raises a clinician_alerts row (reusing failed_referral, already governed in alert_rules) so supervisory review picks it up (task spec §11.12 "Escalation to appropriate clinical team").';

revoke all on function private.raise_stale_urgent_referral_alerts() from public, anon;

select cron.schedule('raise-stale-urgent-referral-alerts', '30 4 * * *', $$select private.raise_stale_urgent_referral_alerts()$$);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'remind-patients-stale-referrals') then
    raise exception 'remind-patients-stale-referrals cron job was not scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'raise-stale-referral-outreach-tasks') then
    raise exception 'raise-stale-referral-outreach-tasks cron job was not scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'raise-stale-urgent-referral-alerts') then
    raise exception 'raise-stale-urgent-referral-alerts cron job was not scheduled';
  end if;
  raise notice 'PASS: all 3 specialist-referral staleness sweeps installed and scheduled';
end $$;
