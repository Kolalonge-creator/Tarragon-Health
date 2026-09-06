-- Lifestyle Management Platform §18.10 — alcohol.
--
-- Screening already exists and is real (AUDIT-C, mental_health_screens
-- instrument='auditc', apps/web/src/lib/rules/mental-health-screening.ts) —
-- left completely untouched here. What's missing per the audit: a tracked
-- reduction goal and an actual consumption log (today there's only the
-- one-off AUDIT-C total + the onboarding alcohol_use bucket). Same
-- singleton-goal + per-day-log shape as patient_weight_goals/
-- activity_log_entries — see the smoking-cessation migration for why this
-- isn't folded into the Lifestyle Programme Engine.

create table public.patient_alcohol_goals (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete restrict,
  patient_id                uuid not null references public.profiles (id) on delete cascade,
  baseline_drinks_per_week  integer check (baseline_drinks_per_week is null or baseline_drinks_per_week >= 0),
  target_drinks_per_week    integer check (target_drinks_per_week is null or target_drinks_per_week >= 0),
  status                    text not null default 'active' check (status in ('active', 'achieved', 'paused')),
  started_at                timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index patient_alcohol_goals_patient_uidx on public.patient_alcohol_goals (patient_id);
create index patient_alcohol_goals_org_idx on public.patient_alcohol_goals (organisation_id);

create trigger set_updated_at before update on public.patient_alcohol_goals
  for each row execute function private.set_updated_at();

create table public.alcohol_consumption_logs (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  logged_on         date not null default current_date,
  drinks_count      integer not null check (drinks_count >= 0),
  context           text check (context is null or context in ('social', 'home', 'work', 'other')),
  created_at        timestamptz not null default now(),
  constraint alcohol_consumption_logs_one_per_day unique (patient_id, logged_on)
);

comment on column public.alcohol_consumption_logs.drinks_count is
  'Standard drinks that day, patient-estimated — same self-report convention as AUDIT-C, not a clinical measurement.';

create index alcohol_consumption_logs_patient_idx on public.alcohol_consumption_logs (patient_id, logged_on desc);
create index alcohol_consumption_logs_org_idx on public.alcohol_consumption_logs (organisation_id);

alter table public.patient_alcohol_goals    enable row level security;
alter table public.alcohol_consumption_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['patient_alcohol_goals', 'alcohol_consumption_logs'] loop
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

grant select, insert, update, delete on public.patient_alcohol_goals to authenticated;
grant select, insert, update, delete on public.alcohol_consumption_logs to authenticated;
revoke all on public.patient_alcohol_goals from anon;
revoke all on public.alcohol_consumption_logs from anon;

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_alcohol_goals') then
    raise exception 'FAIL: patient_alcohol_goals was not created';
  end if;
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'alcohol_consumption_logs') then
    raise exception 'FAIL: alcohol_consumption_logs was not created';
  end if;
  raise notice 'PASS: alcohol consumption tracking — tables, RLS installed';
end $$;
