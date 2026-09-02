-- Spec §76.12/§76.13 (patient dashboard notifications) — a patient should be
-- able to control notification preferences "where appropriate". A live audit
-- of supabase/functions/send-pending-notifications/index.ts and every
-- migration touching `notifications` found no per-user channel-preference
-- table anywhere: `send-pending-notifications` routes purely by template +
-- private.remap_notification_channel(), never by a patient-set preference.
--
-- Deliberately scoped to the ROUTINE send path only. The live critical-
-- notification escalation engine (private.enqueue_critical_notification /
-- private.escalate_unconfirmed_critical_notifications,
-- 20260730153300_critical_notification_engine.sql) is separate, load-bearing
-- clinical-safety infrastructure that never reads this table — a patient
-- cannot opt out of an abnormal-result or emergency alert. `in_app` is not a
-- toggle here either, for the same reason: it is the one channel that needs
-- no external provider and is always the safety-net floor (CLAUDE.md: "app/
-- web is the interface for every core action").
do $$ begin
  create type public.notification_preference_category as enum (
    'appointments', 'medications', 'labs_results', 'screenings_vaccinations',
    'referrals', 'care_messages', 'education_wellness', 'billing'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.patient_notification_preferences (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  category          public.notification_preference_category not null,
  email_enabled     boolean not null default true,
  sms_enabled       boolean not null default true,
  push_enabled      boolean not null default true,
  whatsapp_enabled  boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One row per (patient, category) — a repeat save is an update, not a
  -- second record. A missing row for a category means "use the defaults
  -- above", so the read path never needs to backfill one row per category
  -- per patient up front.
  unique (patient_id, category)
);

create index if not exists patient_notification_preferences_patient_idx
  on public.patient_notification_preferences (patient_id);
create index if not exists patient_notification_preferences_org_idx
  on public.patient_notification_preferences (organisation_id);

drop trigger if exists patient_notification_preferences_set_updated_at
  on public.patient_notification_preferences;
create trigger patient_notification_preferences_set_updated_at
  before update on public.patient_notification_preferences
  for each row execute function private.set_updated_at();

alter table public.patient_notification_preferences enable row level security;

-- Same shape as patient_allergies: patient manages their own rows in full,
-- org clinical staff get read-only visibility (support/troubleshooting a
-- "why didn't my SMS arrive" report), never write.
drop policy if exists patient_notification_preferences_select
  on public.patient_notification_preferences;
create policy patient_notification_preferences_select
  on public.patient_notification_preferences
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_notification_preferences_insert
  on public.patient_notification_preferences;
create policy patient_notification_preferences_insert
  on public.patient_notification_preferences
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

drop policy if exists patient_notification_preferences_update
  on public.patient_notification_preferences;
create policy patient_notification_preferences_update
  on public.patient_notification_preferences
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

drop policy if exists patient_notification_preferences_delete
  on public.patient_notification_preferences;
create policy patient_notification_preferences_delete
  on public.patient_notification_preferences
  for delete to authenticated
  using (patient_id = (select auth.uid()));

-- Freshly created table needs its own grant — RLS restricts rows, it does
-- not grant table-level access (this project's standing gotcha, see
-- reference_authenticated_table_grants_root_cause).
grant select, insert, update, delete on public.patient_notification_preferences to authenticated;
