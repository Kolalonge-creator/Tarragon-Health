-- Health Communication Engine — two-way communication (17.9).
--
-- 17.9's own worked example is exactly this notification: "Are you able to
-- attend your appointment? Yes / Reschedule / Cancel / Need help." Extends
-- private.queue_appointment_reminders() (20260828001728) to attach
-- response_options to every reminder it queues, so the in-app notification
-- UI can render them as quick-reply buttons — POST /api/notifications/[id]/
-- respond (apps/web) captures the tap and calls the same
-- advance_appointment_status/cancel_appointment RPCs the app's own booking
-- UI already uses. Reschedule/Need help have no one-tap action (rescheduling
-- needs a real slot picker; help routes to messages) so they deep-link
-- instead — still captured as a response, just not an in-place action.
--
-- Byte-for-byte identical to the live function except the added
-- response_options value in the insert's select list.
create or replace function private.queue_appointment_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with milestones(milestone, hours_before, high_priority_only) as (
    values
      ('72h', 72.0, true),
      ('24h', 24.0, false),
      ('2h', 2.0, false),
      ('shortly_before', 0.25, false)
  ),
  due as (
    select
      a.id as appointment_id,
      a.organisation_id,
      a.patient_id,
      a.appointment_type,
      a.scheduled_for,
      m.milestone
    from public.appointments a
    cross join milestones m
    where a.status in ('booked', 'confirmed')
      and a.scheduled_for > now()
      and (not m.high_priority_only or a.is_high_priority)
      and a.scheduled_for - now() <= (m.hours_before * interval '1 hour')
  ),
  inserted_state as (
    insert into public.appointment_reminder_sends (appointment_id, milestone)
    select appointment_id, milestone from due
    on conflict (appointment_id, milestone) do nothing
    returning appointment_id, milestone
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, response_options)
  select
    d.organisation_id, d.patient_id, 'whatsapp', 'pending', 'appointment_reminder',
    jsonb_build_object(
      'appointment_id', d.appointment_id, 'scheduled_for', d.scheduled_for,
      'appointment_type', d.appointment_type, 'milestone', d.milestone
    ),
    jsonb_build_array(
      jsonb_build_object('label', 'Yes, I''ll be there', 'value', 'confirm'),
      jsonb_build_object('label', 'Reschedule', 'value', 'reschedule'),
      jsonb_build_object('label', 'Cancel', 'value', 'cancel'),
      jsonb_build_object('label', 'Need help', 'value', 'need_help')
    )
  from due d
  join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone;
$$;

comment on function private.queue_appointment_reminders() is
  '10.13 + 17.9: fires 24h/2h/shortly-before (15 min) reminders for booked/confirmed appointments, plus a 72h reminder for is_high_priority ones, each carrying quick-reply response_options (confirm/reschedule/cancel/need_help — captured by POST /api/notifications/[id]/respond). "Due" is a threshold check (time remaining <= milestone), not an exact-instant match, so a 5-minute cron cadence cannot skip a milestone the way an exact-day match could; the (appointment_id, milestone) dedup key is what stops a repeat send.';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_appointment_reminders'
      and pg_get_functiondef(p.oid) like '%response_options%'
  ) then
    raise exception 'queue_appointment_reminders does not attach response_options';
  end if;
end $$;
