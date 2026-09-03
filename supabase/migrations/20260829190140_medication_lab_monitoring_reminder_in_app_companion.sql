-- Fix: private.queue_medication_lab_monitoring_reminders() (introduced this
-- same session, 20260829160625) only ever queued channel='whatsapp' — the
-- exact class of gap 20260811235133_guarantee_in_app_notification_
-- companions.sql swept the rest of the codebase for and closed everywhere
-- it found it (21 functions), because Meta WABA template approval and
-- Termii sender-ID approval are both still pending platform-wide: a
-- whatsapp-only reminder can currently reach a patient with no active push
-- subscription through zero channels at all. This function was written
-- after that sweep but wasn't part of it (it didn't exist yet), so it
-- shipped with the bug that sweep exists to prevent. Fixed the same way,
-- same shape as the sibling it was modelled on
-- (queue_medication_review_reminders): a queued_in_app CTE reading from the
-- same `due` set.

create or replace function private.queue_medication_lab_monitoring_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select m.id, m.organisation_id, m.patient_id, m.monitoring_label, m.due_date, med.drug_name
    from public.medication_lab_monitoring m
    join public.medications med on med.id = m.medication_id
    where m.status = 'pending'
      and m.reminder_sent_at is null
      and m.due_date is not null
      and m.due_date - interval '7 days' <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'medication_lab_monitoring_due',
      jsonb_build_object('monitoring_label', monitoring_label, 'due_date', due_date, 'drug_name', drug_name)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'medication_lab_monitoring_due',
      jsonb_build_object('monitoring_label', monitoring_label, 'due_date', due_date, 'drug_name', drug_name)
    from due
    returning id
  )
  update public.medication_lab_monitoring m
    set reminder_sent_at = now()
  from due
  where m.id = due.id;
$$;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('private.queue_medication_lab_monitoring_reminders()'::regprocedure) into v_def;
  if v_def not like '%''in_app''%' then
    raise exception 'private.queue_medication_lab_monitoring_reminders is still missing its in_app companion insert';
  end if;
  if v_def not like '%''whatsapp''%' then
    raise exception 'private.queue_medication_lab_monitoring_reminders lost its whatsapp insert';
  end if;
  raise notice 'PASS: queue_medication_lab_monitoring_reminders now queues an in_app companion';
end $$;
