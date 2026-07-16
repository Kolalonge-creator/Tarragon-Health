-- Tarragon Health — medication adherence check-ins (medication pathway, Phase 4)
--
-- After a medication starts, the platform runs a proactive check-in series
-- (pathway Scenario 1, "Step 5 — where Tarragon adds value"):
--   • Day 3   — "Have you started your medication?"
--   • Week 2  — "Any side effects?"
--   • Month 1 — "How many doses have you missed?"
--   • Month 3 — follow-up / lab review due
--
-- Each check-in is a scheduled prompt the patient answers IN THE APP; the
-- WhatsApp/SMS layer only reminds (never the response channel), so this stays
-- inside the notifications-only rule. A clinician/specialist medication
-- auto-schedules the four check-ins; a daily cron reminds as each comes due.
-- All idempotent-guarded.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'medication_checkin_type') then
    create type public.medication_checkin_type as enum
      ('started', 'side_effects', 'missed_doses', 'lab_review');
  end if;
  if not exists (select 1 from pg_type where typname = 'medication_checkin_status') then
    create type public.medication_checkin_status as enum ('pending', 'responded', 'skipped');
  end if;
end $$;

create table if not exists public.medication_adherence_checkins (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  checkin_type      public.medication_checkin_type not null,
  status            public.medication_checkin_status not null default 'pending',
  due_date          date not null,
  response          text,
  reminder_sent_at  timestamptz,
  responded_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (medication_id, checkin_type)
);

create index if not exists med_checkins_patient_due_idx
  on public.medication_adherence_checkins (patient_id, status, due_date);
create index if not exists med_checkins_org_idx
  on public.medication_adherence_checkins (organisation_id, status, due_date);

drop trigger if exists med_checkins_set_updated_at on public.medication_adherence_checkins;
create trigger med_checkins_set_updated_at
  before update on public.medication_adherence_checkins
  for each row execute function private.set_updated_at();

alter table public.medication_adherence_checkins enable row level security;

-- Patient reads + responds to their own check-ins; org staff read/manage.
drop policy if exists med_checkins_select on public.medication_adherence_checkins;
create policy med_checkins_select on public.medication_adherence_checkins
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists med_checkins_insert on public.medication_adherence_checkins;
create policy med_checkins_insert on public.medication_adherence_checkins
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists med_checkins_update on public.medication_adherence_checkins;
create policy med_checkins_update on public.medication_adherence_checkins
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.medication_adherence_checkins to authenticated;

-- --- scheduler: a clinician/specialist medication schedules the 4 check-ins ---
create or replace function private.schedule_medication_checkins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source not in ('clinician', 'specialist') or not new.is_active then
    return new;
  end if;

  insert into public.medication_adherence_checkins
    (organisation_id, patient_id, medication_id, checkin_type, due_date)
  values
    (new.organisation_id, new.patient_id, new.id, 'started',      current_date + 3),
    (new.organisation_id, new.patient_id, new.id, 'side_effects', current_date + 14),
    (new.organisation_id, new.patient_id, new.id, 'missed_doses', current_date + 30),
    (new.organisation_id, new.patient_id, new.id, 'lab_review',   current_date + 90)
  on conflict (medication_id, checkin_type) do nothing;

  return new;
end;
$$;

drop trigger if exists medications_schedule_checkins on public.medications;
create trigger medications_schedule_checkins
  after insert on public.medications
  for each row execute function private.schedule_medication_checkins();

-- --- daily reminder cron -----------------------------------------------------
create or replace function private.queue_medication_checkin_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select c.id, c.organisation_id, c.patient_id, c.checkin_type, m.drug_name
    from public.medication_adherence_checkins c
    join public.medications m on m.id = c.medication_id
    where c.status = 'pending'
      and c.reminder_sent_at is null
      and c.due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'medication_adherence_checkin',
      jsonb_build_object('checkin_type', checkin_type, 'drug_name', drug_name)
    from due
    returning id
  )
  update public.medication_adherence_checkins c
    set reminder_sent_at = now()
  from due
  where c.id = due.id;
$$;

select cron.schedule(
  'medication-checkin-reminders-daily',
  '30 6 * * *',
  $$select private.queue_medication_checkin_reminders();$$
);
