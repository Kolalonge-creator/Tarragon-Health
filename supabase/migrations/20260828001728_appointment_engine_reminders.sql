-- Tarragon Health — Appointment Engine, Phase 5 (reminders)
--
-- 10.13 configurable reminders. Booking confirmation itself is already sent
-- inline by confirm_appointment_booking (20260828001600) the moment a hold
-- turns into a real booking — this migration only covers the *scheduled*
-- reminders (24h/2h/shortly-before), plus a tighter cadence (adds a 72h
-- reminder) for is_high_priority appointments, same "different rules for
-- high-risk" idea the spec calls for. Same dedup-ledger shape as
-- 20260707045443's booking_reminder_sends/queue_booking_reminders: a
-- (appointment_id, milestone) primary key plus insert...on conflict do
-- nothing is what makes re-running this every 5 minutes safe.

create table public.appointment_reminder_sends (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  milestone      text not null,
  sent_at        timestamptz not null default now(),
  primary key (appointment_id, milestone)
);

alter table public.appointment_reminder_sends enable row level security;

create policy appointment_reminder_sends_admin_select
  on public.appointment_reminder_sends for select
  to authenticated
  using (private.is_admin());

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
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    d.organisation_id, d.patient_id, 'whatsapp', 'pending', 'appointment_reminder',
    jsonb_build_object(
      'appointment_id', d.appointment_id, 'scheduled_for', d.scheduled_for,
      'appointment_type', d.appointment_type, 'milestone', d.milestone
    )
  from due d
  join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone;
$$;

comment on function private.queue_appointment_reminders() is
  '10.13: fires 24h/2h/shortly-before (15 min) reminders for booked/confirmed appointments, plus a 72h reminder for is_high_priority ones. "Due" is a threshold check (time remaining <= milestone), not an exact-instant match, so a 5-minute cron cadence cannot skip a milestone the way an exact-day match could; the (appointment_id, milestone) dedup key is what stops a repeat send.';

select cron.schedule(
  'appointment-reminders',
  '*/5 * * * *',
  $$select private.queue_appointment_reminders();$$
);

do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'appointment_reminder_sends'
  ) then
    raise exception 'appointment_reminder_sends missing after migration';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_appointment_reminders'
  ) then
    raise exception 'private.queue_appointment_reminders missing after migration';
  end if;
  raise notice 'PASS: appointment reminder queueing in place';
end $$;
