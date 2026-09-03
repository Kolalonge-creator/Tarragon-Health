-- Tarragon Health — reconcile private.queue_appointment_reminders() after the
-- Family Care Circle branch merged into main-dev.
--
-- Two migrations independently redefined this same function after it diverged
-- from a common base (20260828001728_appointment_engine_reminders.sql):
--   * this branch's 20260829083319_appointment_grantee_access_and_reminders.sql
--     added a second in_app notification, appointment_reminder_for_dependent,
--     to every manage-level profile_access grantee alongside the patient's own
--     reminder (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.3).
--   * main-dev's 20260830002619_appointment_reminder_two_way_response.sql
--     (17.9, health communication engine) attached response_options
--     (confirm/reschedule/cancel/need_help quick-reply buttons) to the
--     patient's own reminder.
-- In migration-timestamp order the second entirely replaced the first's
-- CREATE OR REPLACE, silently dropping the grantee notification even though
-- that migration's own assertion (queue_appointment_reminders extended to
-- notify grantees) had already passed earlier in the same replay. This
-- migration is the forward-fix: one definition carrying both features,
-- following the same "combine both sides in a new migration, never edit an
-- already-committed one" pattern used elsewhere in this project's history
-- (e.g. the search_patient_record reconciliation for PR #324).
--
-- The patient's own reminder keeps response_options exactly as
-- 20260830002619 shipped it. The grantee reminder does not carry
-- response_options: a caregiver tapping "cancel" on someone else's
-- appointment is a different authority question (cancel_appointment already
-- admits a manage grantee, see 20260829083319) than a quick-reply on a
-- notification never designed to carry that action — deliberately left as a
-- read-only heads-up, same scope as it shipped with in the original grantee
-- migration.

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
  ),
  patient_notified as (
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
    join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone
    returning 1
  ),
  grantee_due as (
    select d.*, pa.grantee_user_id
    from due d
    join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone
    join public.profile_access pa
      on pa.profile_id = d.patient_id and pa.permission_level = 'manage'
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  select
    gd.organisation_id, gd.grantee_user_id, 'in_app', 'pending', 'appointment_reminder_for_dependent',
    jsonb_build_object(
      'appointment_id', gd.appointment_id, 'scheduled_for', gd.scheduled_for,
      'appointment_type', gd.appointment_type, 'milestone', gd.milestone, 'patient_id', gd.patient_id
    ),
    'non_clinical'
  from grantee_due gd;
$$;

comment on function private.queue_appointment_reminders() is
  '10.13 + 17.9 + Family Care Circle §3.3, reconciled 2026-09-02: fires 24h/2h/shortly-before (15 min) reminders for booked/confirmed appointments, plus a 72h reminder for is_high_priority ones, to the patient (whatsapp, carrying quick-reply response_options captured by POST /api/notifications/[id]/respond) AND one in_app appointment_reminder_for_dependent notice per manage-level profile_access grantee (read-only, no response_options). Same (appointment_id, milestone) dedup ledger drives both branches, so a grantee is never notified on its own for a milestone the patient reminder has not also just fired for.';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_appointment_reminders'
      and pg_get_functiondef(p.oid) ilike '%response_options%'
  ) then
    raise exception 'queue_appointment_reminders lost the two-way response_options attachment';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_appointment_reminders'
      and pg_get_functiondef(p.oid) ilike '%appointment_reminder_for_dependent%'
  ) then
    raise exception 'queue_appointment_reminders lost the grantee-facing in_app reminder';
  end if;

  raise notice 'PASS: queue_appointment_reminders carries both the two-way response_options and the grantee-facing in_app reminder';
end $$;
