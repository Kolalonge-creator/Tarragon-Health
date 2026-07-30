-- Tarragon Health
-- Steps/activity tracking (Omada-style "Today" screen). Per CLAUDE.md's
-- Device & Wearable Integration section, real step counts from a phone/
-- wearable have no home yet (wearable_readings is schema-scaffolded, no
-- live provider configured) — this is the manual-entry path: a daily step
-- goal + a per-day log of either a step count or a named workout, so the
-- feature works today with zero external dependency. When wearable
-- ingestion goes live, that path should write into this same table
-- (entry_type='steps') rather than a fourth parallel store.

create type public.activity_entry_type as enum ('steps', 'workout');

create table public.patient_activity_goals (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  daily_step_goal   integer not null default 7500 check (daily_step_goal > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index patient_activity_goals_patient_uidx on public.patient_activity_goals (patient_id);
create index patient_activity_goals_org_idx on public.patient_activity_goals (organisation_id);

create trigger set_updated_at before update on public.patient_activity_goals
  for each row execute function private.set_updated_at();

create table public.activity_log_entries (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  entry_type         public.activity_entry_type not null,
  -- Workout-only (e.g. "Indoor Walk", "Swimming"); null for a plain steps row.
  activity_name      text,
  duration_minutes   integer check (duration_minutes is null or duration_minutes > 0),
  -- Steps-only: the day's step count. Null for a workout row (a workout is
  -- tracked by duration, matching the source screenshot's separate entries).
  step_count         integer check (step_count is null or step_count >= 0),
  is_favorite        boolean not null default false,
  logged_on          date not null default current_date,
  logged_at          timestamptz not null default now(),
  note               text,
  created_at         timestamptz not null default now(),
  constraint activity_log_entries_shape_chk check (
    (entry_type = 'steps' and step_count is not null and activity_name is null and duration_minutes is null)
    or
    (entry_type = 'workout' and activity_name is not null and duration_minutes is not null and step_count is null)
  )
);

create index activity_log_entries_patient_idx on public.activity_log_entries (patient_id, logged_at desc);
create index activity_log_entries_org_idx on public.activity_log_entries (organisation_id);

-- One steps total per patient per day — logging today's count again updates
-- the same row (upsert), rather than accumulating duplicate day totals.
create unique index activity_log_entries_steps_per_day_uidx
  on public.activity_log_entries (patient_id, logged_on)
  where entry_type = 'steps';

alter table public.patient_activity_goals enable row level security;
alter table public.activity_log_entries   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['patient_activity_goals', 'activity_log_entries'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
         with check (
           (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
           or private.is_org_staff(organisation_id))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
         using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
         with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated
         using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))', t, t);
  end loop;
end $$;

grant select, insert, update, delete on public.patient_activity_goals to authenticated;
grant select, insert, update, delete on public.activity_log_entries to authenticated;
