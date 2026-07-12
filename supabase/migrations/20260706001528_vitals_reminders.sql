-- Tarragon Health — Sprint 2
-- Vitals logging reminders: admin-configurable cadence (3-day for
-- hypertension/diabetes, monthly otherwise), daily queueing via pg_cron.
--
-- This migration only queues reminders (inserts pending `notifications`
-- rows). The outbound WhatsApp/Termii send is deferred to a later session
-- once real comms credentials exist, mirroring how the Sprint 1
-- abnormal-result alert was scoped.

-- ---------------------------------------------------------------------------
-- vitals_reminder_rules (admin-editable overrides, three mutually exclusive
-- scopes: patient-specific, condition-group, org-wide global default)
-- ---------------------------------------------------------------------------

create table public.vitals_reminder_rules (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  patient_id        uuid references public.profiles (id) on delete cascade,
  condition         public.care_plan_condition,
  frequency_days    integer not null check (frequency_days > 0 and frequency_days <= 90),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint vitals_reminder_rules_single_scope check (patient_id is null or condition is null)
);

-- At most one rule per scope tier per org.
create unique index vitals_reminder_rules_patient_uidx
  on public.vitals_reminder_rules (organisation_id, patient_id)
  where patient_id is not null;

create unique index vitals_reminder_rules_condition_uidx
  on public.vitals_reminder_rules (organisation_id, condition)
  where patient_id is null and condition is not null;

create unique index vitals_reminder_rules_global_uidx
  on public.vitals_reminder_rules (organisation_id)
  where patient_id is null and condition is null;

create index vitals_reminder_rules_org_idx on public.vitals_reminder_rules (organisation_id);

create trigger vitals_reminder_rules_set_updated_at
  before update on public.vitals_reminder_rules
  for each row execute function private.set_updated_at();

alter table public.vitals_reminder_rules enable row level security;

-- Admin is a platform-wide role (private.is_admin() is not org-scoped — see
-- its use on the organisations table itself and on global catalogs like
-- screen_types), and is the only role that touches this table this sprint.
create policy vitals_reminder_rules_admin_select
  on public.vitals_reminder_rules for select
  to authenticated
  using (private.is_admin());

create policy vitals_reminder_rules_admin_insert
  on public.vitals_reminder_rules for insert
  to authenticated
  with check (private.is_admin());

create policy vitals_reminder_rules_admin_update
  on public.vitals_reminder_rules for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy vitals_reminder_rules_admin_delete
  on public.vitals_reminder_rules for delete
  to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- vitals_reminder_state (per-patient due-date bookkeeping, internal only —
-- written exclusively by private.queue_vitals_reminders() below)
-- ---------------------------------------------------------------------------

create table public.vitals_reminder_state (
  patient_id        uuid primary key references public.profiles (id) on delete cascade,
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  next_due_at       date not null,
  reminder_sent_at  timestamptz,
  updated_at        timestamptz not null default now()
);

create index vitals_reminder_state_org_idx on public.vitals_reminder_state (organisation_id);

create trigger vitals_reminder_state_set_updated_at
  before update on public.vitals_reminder_state
  for each row execute function private.set_updated_at();

alter table public.vitals_reminder_state enable row level security;

-- No direct-write policy for any role: private.queue_vitals_reminders() is
-- security definer, owned by postgres, and bypasses RLS as the table owner —
-- same trust model as the other private.* trigger functions in this schema.
create policy vitals_reminder_state_admin_select
  on public.vitals_reminder_state for select
  to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- private.queue_vitals_reminders() — daily due-date computation + queueing
-- ---------------------------------------------------------------------------

create or replace function private.queue_vitals_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with freq as (
    select
      p.id as patient_id,
      p.organisation_id,
      p.created_at,
      coalesce(
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id = p.id),
        (select min(r.frequency_days) from public.vitals_reminder_rules r
           join public.care_plans cp
             on cp.condition = r.condition
            and cp.patient_id = p.id
            and cp.status = 'active'
           where r.patient_id is null
             and r.condition is not null
             and r.organisation_id = p.organisation_id),
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id is null
             and r.condition is null
             and r.organisation_id = p.organisation_id),
        case when exists (
          select 1 from public.care_plans cp
          where cp.patient_id = p.id
            and cp.status = 'active'
            and cp.condition in ('hypertension', 'diabetes')
        ) then 3 else 30 end
      ) as frequency_days
    from public.profiles p
    where p.role = 'patient' and p.organisation_id is not null
  ),
  candidates as (
    select
      f.patient_id,
      f.organisation_id,
      f.frequency_days,
      greatest(
        coalesce(
          (select max(v.taken_at)::date from public.vitals_readings v where v.patient_id = f.patient_id),
          f.created_at::date
        ) + (f.frequency_days || ' days')::interval,
        coalesce(
          (select s.next_due_at from public.vitals_reminder_state s where s.patient_id = f.patient_id),
          '-infinity'::date
        )
      ) as effective_due
    from freq f
  ),
  due as (
    select * from candidates where effective_due <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      'whatsapp',
      'pending',
      'vitals_reminder',
      jsonb_build_object('frequency_days', frequency_days, 'due_date', effective_due)
    from due
    returning recipient_id
  )
  insert into public.vitals_reminder_state (patient_id, organisation_id, next_due_at, reminder_sent_at)
  select patient_id, organisation_id, current_date + frequency_days, now()
  from due
  on conflict (patient_id) do update
    set next_due_at = excluded.next_due_at,
        reminder_sent_at = excluded.reminder_sent_at,
        updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- Daily schedule (07:00 Africa/Lagos = 06:00 UTC, no DST, per CLAUDE.md's
-- fixed-timezone rule)
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

select cron.schedule(
  'vitals-reminders-daily',
  '0 6 * * *',
  $$select private.queue_vitals_reminders();$$
);
