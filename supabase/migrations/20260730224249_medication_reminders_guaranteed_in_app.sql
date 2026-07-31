-- Guaranteed in-app companion for medication refill + adherence reminders.
--
-- Real gap: both reminder crons only ever queue channel='whatsapp'. That row
-- gets remapped to 'push' when the patient has an active push subscription
-- (private.remap_notification_channel, 20260730153333), and a failed
-- push/whatsapp send falls back inline to sms (send-pending-notifications).
-- But a patient with NO push subscription is entirely dependent on the
-- WhatsApp template being Meta-approved and the Termii sender ID being
-- carrier-approved — both are still pending as of this migration (see
-- project memory). If both external approvals are still pending for a given
-- patient, a medication refill/adherence reminder can silently fail with
-- zero patient-visible signal, which is the one notification on this
-- platform where that failure mode is genuinely dangerous (missed refill ->
-- missed dose). Fixed the same way this codebase already fixes exactly this
-- class of gap (health_education_unlock, care_access_requests,
-- health_reset_complete, new_care_message): also queue a companion 'in_app'
-- row from the same `due` set, which NotificationBell renders directly and
-- which needs no external provider approval of any kind.
--
-- `due` is a plain read-only CTE referenced by both insert CTEs plus the
-- final statement/UPDATE — one materialization, both writes fire from it.
-- (Confirmed live in a throwaway rolled-back probe: an unreferenced
-- data-modifying CTE in a WITH chain still executes to completion — the
-- same pattern the pre-existing `queued` CTE already relied on.)

create or replace function private.queue_medication_refill_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with lead as (
    select
      m.id as medication_id,
      m.patient_id,
      m.organisation_id,
      m.drug_name,
      m.refill_date,
      coalesce(
        (select r.lead_days from public.medication_refill_reminder_rules r
           where r.patient_id = m.patient_id),
        (select r.lead_days from public.medication_refill_reminder_rules r
           where r.patient_id is null and r.organisation_id = m.organisation_id),
        7
      ) as lead_days
    from public.medications m
    where m.is_active and m.refill_date is not null
  ),
  due as (
    select l.* from lead l
    where l.refill_date - (l.lead_days || ' days')::interval <= current_date
      -- Overdue guard: go silent once refill_date has lapsed uncorrected —
      -- a clinician/patient updating refill_date is what re-arms reminders.
      and l.refill_date >= current_date
      and not exists (
        select 1 from public.medication_refill_state s
        where s.medication_id = l.medication_id
          and s.reminded_for_refill_date = l.refill_date
      )
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      'whatsapp',
      'pending',
      'medication_refill_reminder',
      jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'refill_date', refill_date)
    from due
    returning recipient_id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      'in_app',
      'pending',
      'medication_refill_reminder',
      jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'refill_date', refill_date)
    from due
    returning recipient_id
  )
  insert into public.medication_refill_state (medication_id, patient_id, organisation_id, reminded_for_refill_date, reminder_sent_at)
  select medication_id, patient_id, organisation_id, refill_date, now()
  from due
  on conflict (medication_id) do update
    set reminded_for_refill_date = excluded.reminded_for_refill_date,
        reminder_sent_at = excluded.reminder_sent_at,
        updated_at = now();
$$;

create or replace function private.queue_medication_checkin_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select c.id, c.organisation_id, c.patient_id, c.checkin_type, m.drug_name
    from public.medication_adherence_checkins c
    join public.medications m on m.id = c.medication_id
    where c.status = 'pending'
      and c.reminder_sent_at is null
      and c.due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'medication_adherence_checkin',
      jsonb_build_object('checkin_type', checkin_type, 'drug_name', drug_name)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'medication_adherence_checkin',
      jsonb_build_object('checkin_type', checkin_type, 'drug_name', drug_name)
    from due
    returning id
  )
  update public.medication_adherence_checkins c
    set reminder_sent_at = now()
  from due
  where c.id = due.id;
$$;

-- Assertion: both functions must still be exactly one round-trip (SECURITY
-- DEFINER, empty search_path) and must now reference 'in_app' in their body.
do $$
declare
  v_refill_def  text;
  v_checkin_def text;
begin
  select pg_get_functiondef('private.queue_medication_refill_reminders()'::regprocedure) into v_refill_def;
  select pg_get_functiondef('private.queue_medication_checkin_reminders()'::regprocedure) into v_checkin_def;

  if v_refill_def not like '%''in_app''%' then
    raise exception 'queue_medication_refill_reminders: in_app companion insert missing';
  end if;
  if v_checkin_def not like '%''in_app''%' then
    raise exception 'queue_medication_checkin_reminders: in_app companion insert missing';
  end if;
end $$;
