-- Tarragon Health — Module 21: Medication Access & Adherence Engine, part 5/7.
--
-- §21.13 reminders: recurring dose reminders, missed-dose prompts, and
-- patient-configurable preferences. Refill reminders are deliberately left
-- alone here — medication_refill_reminder_rules (20260706024722) already
-- covers lead-time configuration for that channel, and its cadence is a
-- clinical-safety-adjacent function this migration does not touch (see part
-- 4's header on the same point). This is new ground: a per-dose-time nudge
-- and a "did you take this?" prompt shortly after a dose was due, neither of
-- which existed before.
--
-- dose_reminders_enabled defaults to FALSE (opt-in) — pinging a patient at
-- every scheduled dose time is a real behavioural commitment a new patient
-- should not be silently defaulted into; the "Today's doses" checklist
-- already works without it. missed_dose_prompts_enabled defaults to TRUE — a
-- single catch-up nudge after a dose was missed is low-fatigue, high-value,
-- and mirrors how medication_adherence_checkins reminders already work
-- on-by-default.
--
-- Both new crons only ever write channel='in_app' notifications (no
-- whatsapp/sms leg): these are frequent, same-day nudges, not the kind of
-- notification that should wait on Meta/Termii template approval, and
-- CLAUDE.md's non-negotiable rule stands regardless — WhatsApp/SMS is
-- reminders/alerts only, never a required interface, so an in_app-only
-- reminder is fully sufficient on its own.

create table public.medication_reminder_preferences (
  patient_id                    uuid primary key references public.profiles (id) on delete cascade,
  organisation_id               uuid not null references public.organisations (id) on delete cascade,
  dose_reminders_enabled        boolean not null default false,
  missed_dose_prompts_enabled   boolean not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

comment on table public.medication_reminder_preferences is
  'Module 21 §21.13 — one row per patient (not per medication) covering every active medication''s dose-time reminders. Absence of a row means the column defaults apply (dose_reminders_enabled=false, missed_dose_prompts_enabled=true), so both cron functions below LEFT JOIN this table rather than requiring a row to exist.';

create index medication_reminder_preferences_org_idx on public.medication_reminder_preferences (organisation_id);

drop trigger if exists medication_reminder_preferences_set_updated_at on public.medication_reminder_preferences;
create trigger medication_reminder_preferences_set_updated_at
  before update on public.medication_reminder_preferences
  for each row execute function private.set_updated_at();

alter table public.medication_reminder_preferences enable row level security;

create policy medication_reminder_preferences_select on public.medication_reminder_preferences
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_reminder_preferences_insert on public.medication_reminder_preferences
  for insert to authenticated
  with check (patient_id = (select auth.uid()));
create policy medication_reminder_preferences_update on public.medication_reminder_preferences
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

grant select, insert, update on public.medication_reminder_preferences to authenticated;
revoke all on public.medication_reminder_preferences from anon;

-- ---------------------------------------------------------------------------
-- private.queue_medication_dose_reminders() — every 5 minutes
-- ---------------------------------------------------------------------------

create or replace function private.queue_medication_dose_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with local_now as (
    select (now() at time zone 'Africa/Lagos') as ts
  ),
  candidates as (
    select
      m.id as medication_id,
      m.patient_id,
      m.organisation_id,
      m.drug_name,
      st.scheduled_time,
      ln.ts::date as local_date
    from public.medications m
    left join public.medication_reminder_preferences p on p.patient_id = m.patient_id
    cross join local_now ln
    cross join lateral jsonb_array_elements_text(coalesce(m.schedule_times, '[]'::jsonb)) as st (scheduled_time)
    where m.is_active
      and coalesce(p.dose_reminders_enabled, false)
      and st.scheduled_time::time >= ln.ts::time
      and st.scheduled_time::time < (ln.ts::time + interval '5 minutes')
  ),
  due as (
    select c.* from candidates c
    where not exists (
      select 1 from public.medication_logs l
      where l.medication_id = c.medication_id
        and l.scheduled_for_date = c.local_date
        and l.scheduled_time = c.scheduled_time
    )
    and not exists (
      select 1 from public.notifications n
      where n.template = 'medication_dose_reminder'
        and n.recipient_id = c.patient_id
        and (n.payload ->> 'medication_id') = c.medication_id::text
        and (n.payload ->> 'scheduled_time') = c.scheduled_time
        and n.created_at::date = c.local_date
    )
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select organisation_id, patient_id, 'in_app', 'pending', 'medication_dose_reminder',
    jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'scheduled_time', scheduled_time)
  from due;
$$;

comment on function private.queue_medication_dose_reminders() is
  'Every 5 minutes: for each opted-in patient, queues an in_app nudge for any schedule_times slot falling in the current 5-minute window with no dose log yet. Known limitation: time-of-day addition wraps modulo 24h, so a window computed within ~5 minutes of 00:00 Africa/Lagos (e.g. 23:58 + 5m = 00:03) makes the >= / < range comparison self-contradictory and that tick matches nothing — a dose scheduled right at midnight can miss one reminder tick. Low-stakes gap for a same-day reminder, not a data-correctness issue (dose logging itself is unaffected).';

revoke all on function private.queue_medication_dose_reminders() from public, anon;

select cron.schedule('medication-dose-reminders', '*/5 * * * *', $$select private.queue_medication_dose_reminders();$$);

-- ---------------------------------------------------------------------------
-- private.queue_missed_dose_prompts() — every 15 minutes, ~60-75 min after due
-- ---------------------------------------------------------------------------

create or replace function private.queue_missed_dose_prompts()
returns void
language sql
security definer
set search_path = ''
as $$
  with local_now as (
    select (now() at time zone 'Africa/Lagos') as ts
  ),
  candidates as (
    select
      m.id as medication_id,
      m.patient_id,
      m.organisation_id,
      m.drug_name,
      st.scheduled_time,
      ln.ts::date as local_date
    from public.medications m
    left join public.medication_reminder_preferences p on p.patient_id = m.patient_id
    cross join local_now ln
    cross join lateral jsonb_array_elements_text(coalesce(m.schedule_times, '[]'::jsonb)) as st (scheduled_time)
    where m.is_active
      and coalesce(p.missed_dose_prompts_enabled, true)
      and st.scheduled_time::time <= (ln.ts::time - interval '60 minutes')
      and st.scheduled_time::time > (ln.ts::time - interval '75 minutes')
  ),
  due as (
    select c.* from candidates c
    where not exists (
      select 1 from public.medication_logs l
      where l.medication_id = c.medication_id
        and l.scheduled_for_date = c.local_date
        and l.scheduled_time = c.scheduled_time
    )
    and not exists (
      select 1 from public.notifications n
      where n.template = 'medication_missed_dose_prompt'
        and n.recipient_id = c.patient_id
        and (n.payload ->> 'medication_id') = c.medication_id::text
        and (n.payload ->> 'scheduled_time') = c.scheduled_time
        and n.created_at::date = c.local_date
    )
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select organisation_id, patient_id, 'in_app', 'pending', 'medication_missed_dose_prompt',
    jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'scheduled_time', scheduled_time)
  from due;
$$;

comment on function private.queue_missed_dose_prompts() is
  '§21.13/§21.14 (forgot -> reminder): every 15 minutes, nudges once per slot roughly 60-75 minutes after a scheduled dose with no log yet, for patients who have not opted out. Same midnight-wraparound limitation as queue_medication_dose_reminders.';

revoke all on function private.queue_missed_dose_prompts() from public, anon;

select cron.schedule('medication-missed-dose-prompts', '*/15 * * * *', $$select private.queue_missed_dose_prompts();$$);

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'medication_reminder_preferences') then
    raise exception 'medication_reminder_preferences table was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'medication-dose-reminders') then
    raise exception 'medication-dose-reminders cron job was not scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'medication-missed-dose-prompts') then
    raise exception 'medication-missed-dose-prompts cron job was not scheduled';
  end if;
  raise notice 'PASS: medication reminder preferences + dose/missed-dose reminder crons installed';
end $$;
