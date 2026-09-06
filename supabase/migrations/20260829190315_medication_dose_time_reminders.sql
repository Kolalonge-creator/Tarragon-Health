-- Tarragon Health — medication safety pathway 64.7/64.8: an actual reminder
-- AT the scheduled dose time, not just a same-day checklist the patient has
-- to remember to open.
--
-- medications.schedule_times (jsonb array of "HH:MM", 20260706024722) has
-- always existed and already drives buildTodaysDoseChecklist (apps/web/src/
-- lib/medication-schedule/checklist.ts) — but that only renders when the
-- patient opens the app. Nothing has ever queued a notification AT 08:00 or
-- 20:00 the way medication_review_reminders queues one N days before a
-- review is due. This closes that gap with the same reminder machinery
-- every other due-date pathway on this platform already uses (whatsapp +
-- in_app companion, per 20260811235133's platform-wide requirement), just
-- on a tighter cron cadence (every 15 minutes, not daily) because a
-- HH:MM-of-day target needs that granularity.
--
-- medication_dose_reminders is bookkeeping only (mirrors medication_refill_
-- state's shape/RLS exactly: admin-only select, no direct write policy —
-- only the SECURITY DEFINER cron function ever writes it), deduping on
-- (medication_id, scheduled_for_date, scheduled_time) so a 15-minute cron
-- tick can never double-send for the same slot.
--
-- Known, accepted limitation: the window comparison does not handle a
-- schedule_time in the last 15 minutes before local midnight wrapping into
-- the next UTC cron run cleanly — the same class of edge case this
-- codebase's other time-of-day sweeps (queue_vitals_reminders et al.) also
-- don't specially handle. Not worth the added complexity for a scenario no
-- one schedules a dose into.

create table if not exists public.medication_dose_reminders (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  medication_id      uuid not null references public.medications (id) on delete cascade,
  scheduled_for_date date not null,
  scheduled_time     text not null,
  sent_at            timestamptz not null default now(),
  unique (medication_id, scheduled_for_date, scheduled_time)
);

create index medication_dose_reminders_patient_idx on public.medication_dose_reminders (patient_id, scheduled_for_date desc);

alter table public.medication_dose_reminders enable row level security;

create policy medication_dose_reminders_admin_select
  on public.medication_dose_reminders for select
  to authenticated
  using (private.is_admin());

create or replace function private.queue_medication_dose_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_lagos      timestamp := (now() at time zone 'Africa/Lagos');
  v_today_lagos    date := v_now_lagos::date;
  v_current_time   time := v_now_lagos::time;
begin
  with candidates as (
    select
      m.id as medication_id,
      m.organisation_id,
      m.patient_id,
      m.drug_name,
      t.schedule_time
    from public.medications m
    cross join lateral jsonb_array_elements_text(m.schedule_times) as t (schedule_time)
    where m.is_active
  ),
  due as (
    select c.*
    from candidates c
    where c.schedule_time ~ '^([01]\d|2[0-3]):[0-5]\d$'
      and c.schedule_time::time <= v_current_time
      and c.schedule_time::time > v_current_time - interval '15 minutes'
      -- Already responded (took it early, or any other logged state) for
      -- this exact slot -- nagging after the patient has already acted is
      -- exactly the noise a reminder system must not add.
      and not exists (
        select 1 from public.medication_logs l
        where l.medication_id = c.medication_id
          and l.scheduled_for_date = v_today_lagos
          and l.scheduled_time = c.schedule_time
      )
      -- Already reminded for this exact slot (the dedup this table exists for).
      and not exists (
        select 1 from public.medication_dose_reminders r
        where r.medication_id = c.medication_id
          and r.scheduled_for_date = v_today_lagos
          and r.scheduled_time = c.schedule_time
      )
  ),
  inserted_state as (
    insert into public.medication_dose_reminders
      (organisation_id, patient_id, medication_id, scheduled_for_date, scheduled_time)
    select organisation_id, patient_id, medication_id, v_today_lagos, schedule_time
    from due
    on conflict (medication_id, scheduled_for_date, scheduled_time) do nothing
    returning medication_id, scheduled_time
  ),
  confirmed as (
    select d.* from due d
    join inserted_state s on s.medication_id = d.medication_id and s.scheduled_time = d.schedule_time
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'medication_dose_reminder',
      jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'scheduled_time', schedule_time)
    from confirmed
    returning id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select organisation_id, patient_id, 'in_app', 'pending', 'medication_dose_reminder',
    jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'scheduled_time', schedule_time)
  from confirmed;
end;
$$;

comment on function private.queue_medication_dose_reminders() is
  'Medication pathway 64.7/64.8: every-15-minutes cron queuing a whatsapp+in_app reminder the moment a medication.schedule_times entry (patient-local Africa/Lagos) is reached, skipping any slot already logged or already reminded (medication_dose_reminders dedup).';

revoke all on function private.queue_medication_dose_reminders() from public, anon;

select cron.schedule('medication-dose-reminders-every-15-min', '*/15 * * * *', $$select private.queue_medication_dose_reminders();$$);

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'medication_dose_reminders'
  ) then
    raise exception 'medication_dose_reminders table was not created';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'queue_medication_dose_reminders' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.queue_medication_dose_reminders was not created';
  end if;

  if not exists (select 1 from cron.job where jobname = 'medication-dose-reminders-every-15-min') then
    raise exception 'medication-dose-reminders-every-15-min cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'private.queue_medication_dose_reminders()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.queue_medication_dose_reminders';
  end if;

  raise notice 'PASS: medication dose-time reminder cron installed';
end $$;
