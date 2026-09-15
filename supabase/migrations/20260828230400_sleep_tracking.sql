-- Lifestyle Management Platform §18.11 — sleep.
--
-- Gap found by audit: 'sleep' exists as an LPE module/measurement-type and a
-- goals-dialog module option, but nothing populates it — no dedicated
-- /patient/sleep route, no duration/quality/routine/daytime-sleepiness
-- logging anywhere. The only sleep data point today is the onboarding's
-- single bucketed sleep_hours answer, used purely for risk scoring.
-- wearable_readings.sleep_minutes exists but only for a patient on a live
-- cloud-OAuth wearable connection (none configured yet per CLAUDE.md).
--
-- Same singleton-goal + per-day-log shape as weight/activity/smoking/
-- alcohol above. Abnormal-finding routing to a clinician (spec §18.11
-- "abnormal findings can trigger appropriate clinical assessment") is
-- handled app-side after insert, same pattern as flagCvRiskEscalations —
-- see apps/web/src/lib/sleep/escalate.ts.

create table public.patient_sleep_goals (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  target_duration_hours  numeric(3,1) check (target_duration_hours is null or target_duration_hours between 0 and 24),
  target_bedtime         time,
  target_waketime        time,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index patient_sleep_goals_patient_uidx on public.patient_sleep_goals (patient_id);
create index patient_sleep_goals_org_idx on public.patient_sleep_goals (organisation_id);

create trigger set_updated_at before update on public.patient_sleep_goals
  for each row execute function private.set_updated_at();

create table public.sleep_log_entries (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  logged_on            date not null default current_date,
  duration_hours       numeric(3,1) not null check (duration_hours between 0 and 24),
  quality_rating       integer check (quality_rating is null or quality_rating between 1 and 5),
  bedtime              time,
  waketime             time,
  -- 0 = would never doze off during the day, 3 = high chance of dozing —
  -- a deliberately short single-item version of Epworth-style daytime
  -- sleepiness (spec §18.11), not the full 8-item clinical instrument.
  daytime_sleepiness   integer check (daytime_sleepiness is null or daytime_sleepiness between 0 and 3),
  note                 text,
  created_at           timestamptz not null default now(),
  constraint sleep_log_entries_one_per_day unique (patient_id, logged_on)
);

create index sleep_log_entries_patient_idx on public.sleep_log_entries (patient_id, logged_on desc);
create index sleep_log_entries_org_idx on public.sleep_log_entries (organisation_id);

alter table public.patient_sleep_goals enable row level security;
alter table public.sleep_log_entries   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['patient_sleep_goals', 'sleep_log_entries'] loop
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

grant select, insert, update, delete on public.patient_sleep_goals to authenticated;
grant select, insert, update, delete on public.sleep_log_entries to authenticated;
revoke all on public.patient_sleep_goals from anon;
revoke all on public.sleep_log_entries from anon;

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_sleep_goals') then
    raise exception 'FAIL: patient_sleep_goals was not created';
  end if;
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sleep_log_entries') then
    raise exception 'FAIL: sleep_log_entries was not created';
  end if;
  raise notice 'PASS: sleep tracking — tables, RLS installed';
end $$;
