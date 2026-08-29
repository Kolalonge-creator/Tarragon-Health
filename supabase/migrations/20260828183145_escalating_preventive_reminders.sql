-- Tarragon Health — Risk & Prevention Engine enhancement, 7/7
-- Escalating preventive reminders (spec §2.11: "Reminder intensity should
-- increase appropriately: Upcoming -> Due -> Overdue -> Escalation").
--
-- Today private.queue_screening_reminders()/queue_vaccination_reminders()
-- (redefined most recently in 20260811235133_guarantee_in_app_notification_
-- companions.sql) send exactly ONE reminder ever, gated by
-- reminder_sent_at is null. That's the entire "reminder engine" for
-- patient-facing preventive nudges — there is no ramp. (A real escalating,
-- confirmation-gated multi-channel ladder DOES already exist in this
-- codebase — escalation_slas / private.escalation_channel_sequence — but
-- it's scoped to clinical-alert escalation to STAFF, not patient nudges;
-- reusing it here would be the wrong fit, not a shortcut.)
--
-- Staging is date-driven (days relative to due_date), NOT
-- status = 'overdue' — that enum value exists on screening_status but
-- nothing in this codebase automatically sets it; every other place that
-- treats a schedule as overdue (patient_care_gaps' overdue_screening gap
-- type, preventive-screening-calendar.tsx's isOverdue) computes it the same
-- way, from due_date < current_date while status is still 'pending'/
-- 'booked'. Gating stage transitions on a status transition nothing
-- performs would leave the overdue/escalated stages dead for effectively
-- every patient, so this follows the same date-driven convention instead
-- (status = 'overdue', if a clinician ever sets it by hand, still stays
-- included in every stage's base filter — it just isn't what decides which
-- stage a row is in).
--
-- Each stage fires at most once per schedule row (reminder_stage only ever
-- moves forward), so this still can't spiral into alert fatigue (spec
-- §2.15's stated goal) — four nudges total across a schedule's whole
-- lifetime, not per-day.
--
-- The human-escalation layer this ladder feeds INTO already exists and is
-- untouched: patient_care_gaps' overdue_screening gap type starts counting
-- a row the moment due_date < current_date (immediately, well before this
-- ladder's own "overdue"/"escalated" stages at +7/+21 days), and
-- private.queue_care_outreach() already turns that into a Care Coordinator
-- task on its own nightly run. So by the time a patient gets even the
-- "overdue" nudge, a human is very likely already following up — this
-- ladder is the patient-facing half of that same picture, not a competing
-- mechanism.

-- Tarragon Health — Risk & Prevention Engine enhancement, 7/7. Committed to
-- git but never actually applied to production. Content byte-identical to
-- the committed 20260827205740_escalating_preventive_reminders.sql.

create type public.reminder_stage as enum ('upcoming', 'due', 'overdue', 'escalated');

alter table public.screening_schedules
  add column if not exists reminder_stage public.reminder_stage;
alter table public.vaccination_schedules
  add column if not exists reminder_stage public.reminder_stage;

comment on column public.screening_schedules.reminder_stage is
  'How far up the upcoming->due->overdue->escalated ladder this schedule''s '
  'reminders have reached. Null = no reminder sent yet. Only ever moves '
  'forward (see private.queue_screening_reminders()). Staging is date-driven '
  '(days relative to due_date), not this row''s status value.';
comment on column public.vaccination_schedules.reminder_stage is
  'Same ladder as screening_schedules.reminder_stage — see private.queue_vaccination_reminders().';

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
    where s.status in ('pending', 'booked', 'overdue')
      and s.reminder_stage is null
      and s.due_date > current_date
      and s.due_date <= current_date + 7
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'screening_upcoming',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'screening_upcoming',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_stage = 'upcoming', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status in ('pending', 'booked', 'overdue')
      and (s.reminder_stage is null or s.reminder_stage = 'upcoming')
      and s.due_date <= current_date
      and s.due_date >= current_date - 6
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'screening_due',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'screening_due',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_stage = 'due', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status in ('pending', 'booked', 'overdue')
      and (s.reminder_stage is null or s.reminder_stage in ('upcoming', 'due'))
      and s.due_date < current_date - 6
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'screening_overdue',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'screening_overdue',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_stage = 'overdue', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status in ('pending', 'booked', 'overdue')
      and s.reminder_stage = 'overdue'
      and s.due_date < current_date - 20
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'screening_escalated',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'screening_escalated',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_push as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'push', 'pending', 'screening_escalated',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_stage = 'escalated', reminder_sent_at = now()
  from due
  where s.id = due.id;
$$;

create or replace function private.queue_vaccination_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status in ('pending', 'booked', 'overdue')
      and s.reminder_stage is null
      and s.due_date > current_date
      and s.due_date <= current_date + 7
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'vaccination_upcoming',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'vaccination_upcoming',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_stage = 'upcoming', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status in ('pending', 'booked', 'overdue')
      and (s.reminder_stage is null or s.reminder_stage = 'upcoming')
      and s.due_date <= current_date
      and s.due_date >= current_date - 6
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'vaccination_due',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'vaccination_due',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_stage = 'due', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status in ('pending', 'booked', 'overdue')
      and (s.reminder_stage is null or s.reminder_stage in ('upcoming', 'due'))
      and s.due_date < current_date - 6
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'vaccination_overdue',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'vaccination_overdue',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_stage = 'overdue', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status in ('pending', 'booked', 'overdue')
      and s.reminder_stage = 'overdue'
      and s.due_date < current_date - 20
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'vaccination_escalated',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'vaccination_escalated',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_push as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'push', 'pending', 'vaccination_escalated',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_stage = 'escalated', reminder_sent_at = now()
  from due
  where s.id = due.id;
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'screening_schedules' and column_name = 'reminder_stage'
  ) then
    raise exception 'FAIL: screening_schedules.reminder_stage was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vaccination_schedules' and column_name = 'reminder_stage'
  ) then
    raise exception 'FAIL: vaccination_schedules.reminder_stage was not added';
  end if;

  raise notice 'PASS: escalating reminder ladder installed for screening and vaccination schedules';
end $$;
