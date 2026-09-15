-- Lifestyle Management Platform §18.9 — smoking cessation.
--
-- Gap found by audit: smoking exists ONLY as a one-shot onboarding answer
-- (risk_assessment_responses.smoking_status/cigarettes_per_day, consumed
-- once by prevention_risk_scores) — zero rows anywhere named quit_date,
-- cessation, quit_motivation, or smoking_trigger. This is a genuinely new
-- tracked programme, not an extension of an existing table.
--
-- Deliberately NOT folded into the Lifestyle Programme Engine (lpe_*):
-- the LPE's condition/module vocabulary (packages/lifestyle-engine) has no
-- room for smoking without a breaking change to its Module type, and it's
-- scoped to htn/diabetes/obesity only. Follows the same standalone
-- singleton-goal + per-day-log shape already proven for weight
-- (patient_weight_goals) and activity (patient_activity_goals +
-- activity_log_entries) instead.

create type public.smoking_status as enum ('never', 'former', 'current');

create type public.smoking_trigger as enum (
  'stress', 'social', 'alcohol', 'after_meals', 'boredom', 'habit', 'craving', 'other'
);

-- One row per patient: current status + an optional quit plan. A patient
-- moving from 'current' to 'former' sets quit_date themselves; nothing here
-- infers or defaults a quit date the patient hasn't actually confirmed.
create table public.patient_smoking_profiles (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  status            public.smoking_status not null default 'never',
  cigarettes_per_day integer check (cigarettes_per_day is null or cigarettes_per_day >= 0),
  years_smoking     numeric(4,1) check (years_smoking is null or years_smoking >= 0),
  quit_motivation   integer check (quit_motivation is null or quit_motivation between 0 and 10),
  quit_date         date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint patient_smoking_profiles_cigs_only_if_current
    check (cigarettes_per_day is null or status = 'current')
);

comment on column public.patient_smoking_profiles.quit_motivation is
  '0-10 self-rated readiness to quit (spec §18.9 "quit motivation") — never inferred, always patient-entered.';

create unique index patient_smoking_profiles_patient_uidx on public.patient_smoking_profiles (patient_id);
create index patient_smoking_profiles_org_idx on public.patient_smoking_profiles (organisation_id);

create trigger set_updated_at before update on public.patient_smoking_profiles
  for each row execute function private.set_updated_at();

-- Daily check-in: cigarettes actually smoked that day (0 = smoke-free day),
-- cravings, and named triggers — the progress + trigger tracking spec §18.9
-- asks for. One row per patient per day, same upsert-by-day shape as
-- activity_log_entries' steps rows.
create table public.smoking_check_ins (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  logged_on           date not null default current_date,
  cigarettes_smoked   integer not null default 0 check (cigarettes_smoked >= 0),
  cravings_intensity  integer check (cravings_intensity is null or cravings_intensity between 0 and 10),
  triggers            public.smoking_trigger[] not null default '{}',
  note                text,
  created_at          timestamptz not null default now(),
  constraint smoking_check_ins_one_per_day unique (patient_id, logged_on)
);

create index smoking_check_ins_patient_idx on public.smoking_check_ins (patient_id, logged_on desc);
create index smoking_check_ins_org_idx on public.smoking_check_ins (organisation_id);

alter table public.patient_smoking_profiles enable row level security;
alter table public.smoking_check_ins        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['patient_smoking_profiles', 'smoking_check_ins'] loop
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

grant select, insert, update, delete on public.patient_smoking_profiles to authenticated;
grant select, insert, update, delete on public.smoking_check_ins to authenticated;
revoke all on public.patient_smoking_profiles from anon;
revoke all on public.smoking_check_ins from anon;

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_smoking_profiles') then
    raise exception 'FAIL: patient_smoking_profiles was not created';
  end if;
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'smoking_check_ins') then
    raise exception 'FAIL: smoking_check_ins was not created';
  end if;
  raise notice 'PASS: smoking cessation tracking — tables, RLS installed';
end $$;
