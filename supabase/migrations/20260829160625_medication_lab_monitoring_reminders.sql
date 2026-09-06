-- Tarragon Health — medication safety pathway 64.13: "medication started ->
-- monitoring protocol -> test due in N weeks -> REMINDER -> result ->
-- clinical review". drug_class_lab_monitoring.sql (20260716173000) already
-- builds every leg except the reminder: it computes medication_lab_
-- monitoring.due_date from drug_monitoring_rules, but nothing ever tells the
-- patient a test is due — unlike medication_reviews and medication_
-- adherence_checkins, which both already have their own reminder_sent_at
-- column and a daily cron (queue_medication_review_reminders,
-- queue_medication_checkin_reminders), medication_lab_monitoring never got
-- either. This adds both, in exactly that same shape.

alter table public.medication_lab_monitoring
  add column if not exists reminder_sent_at timestamptz;

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
  )
  update public.medication_lab_monitoring m
    set reminder_sent_at = now()
  from due
  where m.id = due.id;
$$;

comment on function private.queue_medication_lab_monitoring_reminders() is
  'Medication pathway 64.13: daily cron queuing a patient reminder once a medication_lab_monitoring row''s due_date is within 7 days, mirroring queue_medication_review_reminders/queue_medication_checkin_reminders''s exact shape. A row with due_date null ("as clinically indicated", no fixed cadence) is never queued — there is no date to be "within 7 days" of.';

revoke all on function private.queue_medication_lab_monitoring_reminders() from public, anon;

select cron.schedule(
  'medication-lab-monitoring-reminders-daily',
  '35 6 * * *',
  $$select private.queue_medication_lab_monitoring_reminders();$$
);

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medication_lab_monitoring' and column_name = 'reminder_sent_at'
  ) then
    raise exception 'medication_lab_monitoring.reminder_sent_at was not added';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'queue_medication_lab_monitoring_reminders' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.queue_medication_lab_monitoring_reminders was not created';
  end if;

  if not exists (select 1 from cron.job where jobname = 'medication-lab-monitoring-reminders-daily') then
    raise exception 'medication-lab-monitoring-reminders-daily cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'private.queue_medication_lab_monitoring_reminders()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.queue_medication_lab_monitoring_reminders';
  end if;

  raise notice 'PASS: medication_lab_monitoring reminder column + daily cron installed';
end $$;
