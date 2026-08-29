-- Tarragon Health — Appointment Engine, Phase 7 (preparation reminder)
--
-- 69.14 lists four reminder kinds: booking confirmation (sent inline by
-- confirm_appointment_booking), pre-appointment reminder and day-of reminder
-- (the existing 72h/24h/2h/shortly_before milestones from
-- 20260828001728_appointment_engine_reminders.sql), and preparation
-- reminder — the one still missing. This adds a fifth milestone ('prep')
-- that only fires when the appointment actually carries 69.6 preparation
-- content (preparation_instructions, documents_required, or
-- investigations_required), at 48h out — between the 72h high-priority-only
-- reminder and the generic 24h one, giving a patient with something to
-- prepare (fast, bring a document, get a test done first) real lead time
-- separate from the plain "your appointment is coming up" nudge. Same
-- (appointment_id, milestone) dedup-ledger shape as every other reminder in
-- this codebase — reruns every 5 minutes safely.

create or replace function private.queue_appointment_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with milestones(milestone, hours_before, high_priority_only) as (
    values
      ('72h', 72.0, true),
      ('prep', 48.0, false),
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
      and (
        m.milestone <> 'prep'
        or a.preparation_instructions is not null
        or coalesce(array_length(a.documents_required, 1), 0) > 0
        or coalesce(array_length(a.investigations_required, 1), 0) > 0
      )
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
    d.organisation_id, d.patient_id,
    'whatsapp', 'pending',
    case when d.milestone = 'prep' then 'appointment_preparation_reminder' else 'appointment_reminder' end,
    case when d.milestone = 'prep'
      then jsonb_build_object(
        'appointment_id', a.id, 'scheduled_for', a.scheduled_for, 'appointment_type', a.appointment_type,
        'preparation_instructions', a.preparation_instructions,
        'documents_required', a.documents_required,
        'investigations_required', a.investigations_required
      )
      else jsonb_build_object(
        'appointment_id', d.appointment_id, 'scheduled_for', d.scheduled_for,
        'appointment_type', d.appointment_type, 'milestone', d.milestone
      )
    end
  from due d
  join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone
  join public.appointments a on a.id = d.appointment_id;
$$;

comment on function private.queue_appointment_reminders() is
  '69.14: fires 24h/2h/shortly-before (15 min) reminders for booked/confirmed appointments, a 72h reminder for is_high_priority ones, and a 48h ''prep'' reminder (own template, own payload) whenever the appointment carries 69.6 preparation content. The (appointment_id, milestone) dedup key stops a repeat send.';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_appointment_reminders'
  ) then
    raise exception 'private.queue_appointment_reminders missing after migration';
  end if;
  raise notice 'PASS: preparation reminder milestone in place';
end $$;
