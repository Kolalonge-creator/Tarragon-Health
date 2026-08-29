-- Tarragon Health — Result Lifecycle §58.16: "Recall scheduled -> Patient
-- reminded -> Test completed." The scheduling and completion halves are
-- automatic triggers (20260829122600_result_recalls.sql); this is the
-- reminder half, same shape as private.queue_screening_reminders
-- (20260807121855_screening_due_reminders.sql) — an in-app-only nudge, never
-- required for the recall itself to function, matching every other
-- reminder cron in this codebase (booking/logging a repeat test always
-- happens in-app; WhatsApp/SMS is never a required interface).
--
-- 'in_app' + content_class='clinical': a recall reminder names an actual
-- test/date, which is clinical content — the notifications_no_clinical_on_
-- open_rail CHECK (20260730094515) rejects that content_class on
-- whatsapp/sms/email outright, so this could not accidentally regress onto
-- an open rail even if a future edit tried.

create or replace function private.send_result_recall_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select r.id, r.organisation_id, r.patient_id, r.repeat_due_date,
           coalesce(st.name, r.screen_type_code) as screen_type_name
    from public.result_recalls r
    left join public.screen_types st on st.code = r.screen_type_code
    where r.status = 'scheduled'
      and r.reminded_at is null
      and r.repeat_due_date <= current_date + 7
  ),
  queued as (
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'result_recall_due',
      jsonb_build_object(
        'recall_id', id,
        'screen_type_name', screen_type_name,
        'repeat_due_date', repeat_due_date
      ),
      'clinical'
    from due
    returning id
  )
  update public.result_recalls r
    set status = 'reminded', reminded_at = now()
  from due
  where r.id = due.id;
$$;

revoke all on function private.send_result_recall_reminders() from public;

select cron.schedule(
  'result-recall-reminders-daily',
  '15 7 * * *',
  $$select private.send_result_recall_reminders();$$
);

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'send_result_recall_reminders'
  ) then
    raise exception 'send_result_recall_reminders was not created';
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'result-recall-reminders-daily'
  ) then
    raise exception 'result-recall-reminders-daily cron job was not registered';
  end if;
end $$;
