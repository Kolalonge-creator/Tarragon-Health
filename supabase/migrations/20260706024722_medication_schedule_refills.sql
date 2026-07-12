-- Tarragon Health — Sprint 2
-- Medication schedule + refill reminders:
--   * patients can now self-add medications, not just clinicians
--   * structured per-dose schedule_times so the app can show "due at 8am"
--   * admin-configurable refill lead-time, daily pg_cron queueing of
--     `notifications` rows (send is deferred to a later session, same as
--     the vitals reminders and Sprint 1 abnormal-result alert).

-- ---------------------------------------------------------------------------
-- medications: structured schedule + provenance
-- ---------------------------------------------------------------------------

create type public.medication_source as enum ('clinician', 'patient');

alter table public.medications
  add column schedule_times jsonb not null default '[]'::jsonb, -- e.g. ["08:00","20:00"]
  add column source public.medication_source not null default 'clinician',
  add column added_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- medication_logs: tie a log entry to a specific scheduled dose
-- ---------------------------------------------------------------------------

alter table public.medication_logs
  add column scheduled_time text,       -- "HH:MM", null for freeform/as-needed logs
  add column scheduled_for_date date;   -- patient-local (Africa/Lagos) date the slot applies to

-- Idempotent per-slot logging: at most one log row per medication/date/time.
create unique index medication_logs_scheduled_dose_uidx
  on public.medication_logs (medication_id, scheduled_for_date, scheduled_time)
  where scheduled_time is not null;

-- ---------------------------------------------------------------------------
-- medications RLS: allow patient self-service alongside existing staff access
-- ---------------------------------------------------------------------------

drop policy medications_insert on public.medications;
drop policy medications_update on public.medications;

-- source = 'patient' check stops a patient from labeling their own entry as
-- clinician-prescribed; staff inserts are unrestricted on source.
create policy medications_insert on public.medications
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
  );

-- Full edit parity for patient and staff on any row (matches the trust model
-- already used for vitals_readings/medication_logs) — DELETE stays
-- staff-only (medications_delete, unchanged) so a patient can deactivate via
-- is_active but not erase the record.
create policy medications_update on public.medications
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- ---------------------------------------------------------------------------
-- medication_refill_reminder_rules (admin-editable overrides, two mutually
-- exclusive scopes: patient-specific, org-wide global default — no
-- condition dimension, unlike vitals reminders)
-- ---------------------------------------------------------------------------

create table public.medication_refill_reminder_rules (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  patient_id        uuid references public.profiles (id) on delete cascade,
  lead_days         integer not null check (lead_days > 0 and lead_days <= 30),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index medication_refill_rules_patient_uidx
  on public.medication_refill_reminder_rules (organisation_id, patient_id)
  where patient_id is not null;

create unique index medication_refill_rules_global_uidx
  on public.medication_refill_reminder_rules (organisation_id)
  where patient_id is null;

create index medication_refill_rules_org_idx on public.medication_refill_reminder_rules (organisation_id);

create trigger medication_refill_rules_set_updated_at
  before update on public.medication_refill_reminder_rules
  for each row execute function private.set_updated_at();

alter table public.medication_refill_reminder_rules enable row level security;

create policy medication_refill_rules_admin_select
  on public.medication_refill_reminder_rules for select
  to authenticated
  using (private.is_admin());

create policy medication_refill_rules_admin_insert
  on public.medication_refill_reminder_rules for insert
  to authenticated
  with check (private.is_admin());

create policy medication_refill_rules_admin_update
  on public.medication_refill_reminder_rules for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy medication_refill_rules_admin_delete
  on public.medication_refill_reminder_rules for delete
  to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- medication_refill_state (per-medication bookkeeping, internal only —
-- written exclusively by private.queue_medication_refill_reminders() below)
-- ---------------------------------------------------------------------------

create table public.medication_refill_state (
  medication_id             uuid primary key references public.medications (id) on delete cascade,
  patient_id                uuid not null references public.profiles (id) on delete cascade,
  organisation_id           uuid not null references public.organisations (id) on delete cascade,
  reminded_for_refill_date  date not null,
  reminder_sent_at          timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index medication_refill_state_org_idx on public.medication_refill_state (organisation_id);
create index medication_refill_state_patient_idx on public.medication_refill_state (patient_id);

create trigger medication_refill_state_set_updated_at
  before update on public.medication_refill_state
  for each row execute function private.set_updated_at();

alter table public.medication_refill_state enable row level security;

create policy medication_refill_state_admin_select
  on public.medication_refill_state for select
  to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- private.queue_medication_refill_reminders() — daily lead-time computation
-- + queueing
-- ---------------------------------------------------------------------------

create or replace function private.queue_medication_refill_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with lead as (
    select
      m.id as medication_id,
      m.patient_id,
      m.organisation_id,
      m.drug_name,
      m.refill_date,
      coalesce(
        (select r.lead_days from public.medication_refill_reminder_rules r
           where r.patient_id = m.patient_id),
        (select r.lead_days from public.medication_refill_reminder_rules r
           where r.patient_id is null and r.organisation_id = m.organisation_id),
        7
      ) as lead_days
    from public.medications m
    where m.is_active and m.refill_date is not null
  ),
  due as (
    select l.* from lead l
    where l.refill_date - (l.lead_days || ' days')::interval <= current_date
      -- Overdue guard: go silent once refill_date has lapsed uncorrected —
      -- a clinician/patient updating refill_date is what re-arms reminders.
      and l.refill_date >= current_date
      and not exists (
        select 1 from public.medication_refill_state s
        where s.medication_id = l.medication_id
          and s.reminded_for_refill_date = l.refill_date
      )
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      'whatsapp',
      'pending',
      'medication_refill_reminder',
      jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'refill_date', refill_date)
    from due
    returning recipient_id
  )
  insert into public.medication_refill_state (medication_id, patient_id, organisation_id, reminded_for_refill_date, reminder_sent_at)
  select medication_id, patient_id, organisation_id, refill_date, now()
  from due
  on conflict (medication_id) do update
    set reminded_for_refill_date = excluded.reminded_for_refill_date,
        reminder_sent_at = excluded.reminder_sent_at,
        updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- Daily schedule (07:10 Africa/Lagos = 06:10 UTC, offset from the vitals
-- reminder job's 07:00 slot)
-- ---------------------------------------------------------------------------

select cron.schedule(
  'medication-refill-reminders-daily',
  '10 6 * * *',
  $$select private.queue_medication_refill_reminders();$$
);
