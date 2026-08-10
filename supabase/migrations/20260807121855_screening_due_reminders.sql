-- Tarragon Health — screening-due reminder cron, the screening_schedules
-- analogue of private.queue_vaccination_reminders
-- (20260716190000_vaccination_schedules.sql).
--
-- Background: screening_schedules.reminder_sent_at has existed since the
-- table was first created (20260705211237_prevention.sql) but nothing ever
-- consumed it — computeScreeningRecommendations/submitRiskAssessment writes
-- and refreshes due_date rows (most recently
-- 20260802232317_screening_schedule_refresh_on_result.sql, which opens a
-- fresh row with reminder_sent_at = null on every completed cycle), but no
-- cron ever turned a due date into an actual patient nudge the way
-- vaccinations and preventive reviews already do. This closes that one gap
-- with the same shape, not a new mechanism.
--
-- Reminder only — booking/logging a screening always happens in-app, never
-- over WhatsApp/SMS, matching every other reminder cron in this codebase.

create or replace function private.queue_screening_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status = 'pending'
      and s.reminder_sent_at is null
      and s.due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'screening_due',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_sent_at = now()
  from due
  where s.id = due.id;
$$;

select cron.schedule(
  'screening-reminders-daily',
  '35 6 * * *',
  $$select private.queue_screening_reminders();$$
);

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_screening_reminders'
  ) then
    raise exception 'queue_screening_reminders was not created';
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'screening-reminders-daily'
  ) then
    raise exception 'screening-reminders-daily cron job was not registered';
  end if;
end $$;
