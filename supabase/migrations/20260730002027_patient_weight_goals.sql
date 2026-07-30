-- Tarragon Health
-- Weight-loss goal tracking (Omada-style "Weight" screen): a starting weight
-- + goal weight per patient, so the existing weight trend chart
-- (vitals_readings, vital_type='weight') can render a goal reference line
-- and "starting / goal / change so far" stats. One active goal per patient
-- (a fresh goal replaces the old one via upsert — same simple singleton
-- shape as reproductive_health_profiles, not a history table).

create table public.patient_weight_goals (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  starting_weight_kg  numeric(5, 2) not null check (starting_weight_kg > 0),
  goal_weight_kg       numeric(5, 2) not null check (goal_weight_kg > 0),
  started_at          date not null default current_date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index patient_weight_goals_patient_uidx on public.patient_weight_goals (patient_id);
create index patient_weight_goals_org_idx on public.patient_weight_goals (organisation_id);

create trigger set_updated_at before update on public.patient_weight_goals
  for each row execute function private.set_updated_at();

alter table public.patient_weight_goals enable row level security;

create policy patient_weight_goals_select on public.patient_weight_goals
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy patient_weight_goals_insert on public.patient_weight_goals
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

create policy patient_weight_goals_update on public.patient_weight_goals
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy patient_weight_goals_delete on public.patient_weight_goals
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_weight_goals to authenticated;
