-- Tarragon Health — Preventive Health Pathway, Gap 1
-- vaccination_schedules: a persisted, reminder-bearing vaccination calendar,
-- the vaccination analogue of screening_schedules.
--
-- Background: the platform already computes per-vaccine due/overdue state on
-- render (computeVaccinationStatuses over vaccination_catalog + records), but
-- nothing was persisted, so no reminder cron could fire the way screenings and
-- medication reviews do. This table is a *materialised projection* of that same
-- pure engine (single source of truth stays the engine — the app regenerates
-- these rows at the natural write moments: onboarding risk submit + each logged
-- dose), whose only job is to let a plain-SQL daily cron enqueue reminders.
--
-- Reuses the existing screening_status enum (pending/booked/completed/overdue/
-- cancelled) rather than inventing a parallel one — the lifecycle is identical.

create table if not exists public.vaccination_schedules (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  vaccination_catalog_id  uuid not null references public.vaccination_catalog (id) on delete restrict,
  status                  public.screening_status not null default 'pending',
  due_date                date not null,
  reminder_sent_at        timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists vaccination_schedules_patient_idx
  on public.vaccination_schedules (patient_id, due_date);
create index if not exists vaccination_schedules_org_status_idx
  on public.vaccination_schedules (organisation_id, status, due_date);
-- At most one active (pending/booked) schedule per patient+vaccine — the
-- tighten-only regeneration in generateVaccinationSchedules relies on this.
create unique index if not exists vaccination_schedules_one_active
  on public.vaccination_schedules (patient_id, vaccination_catalog_id)
  where status in ('pending', 'booked');

drop trigger if exists vaccination_schedules_set_updated_at on public.vaccination_schedules;
create trigger vaccination_schedules_set_updated_at
  before update on public.vaccination_schedules
  for each row execute function private.set_updated_at();

alter table public.vaccination_schedules enable row level security;

-- Patient reads/writes own (self-reported entries are in scope for the
-- registry, same as vaccination_records); org staff manage. Mirrors
-- screening_schedules' patient-or-staff policy exactly.
drop policy if exists vaccination_schedules_select on public.vaccination_schedules;
create policy vaccination_schedules_select on public.vaccination_schedules
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists vaccination_schedules_insert on public.vaccination_schedules;
create policy vaccination_schedules_insert on public.vaccination_schedules
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists vaccination_schedules_update on public.vaccination_schedules;
create policy vaccination_schedules_update on public.vaccination_schedules
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists vaccination_schedules_delete on public.vaccination_schedules;
create policy vaccination_schedules_delete on public.vaccination_schedules
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.vaccination_schedules to authenticated;

-- --- daily reminder cron -----------------------------------------------------
-- Enqueues a patient reminder as a scheduled vaccination comes due, same shape
-- as queue_medication_review_reminders. Reminder only — booking/logging still
-- happens in-app; WhatsApp/SMS never becomes a data-entry interface.
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
    where s.status = 'pending'
      and s.reminder_sent_at is null
      and s.due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'vaccination_due',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_sent_at = now()
  from due
  where s.id = due.id;
$$;

select cron.schedule(
  'vaccination-reminders-daily',
  '25 6 * * *',
  $$select private.queue_vaccination_reminders();$$
);
