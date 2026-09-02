-- Tarragon Health — Menstrual cycle tracking (period history + daily logs)
--
-- The women's-health bridge (20260724001210_reproductive_health_profile.sql)
-- gave every patient a single row holding `last_period_date` and a
-- self-reported `average_cycle_length_days`, and estimated the next period as
-- last + average (defaulting to 28). That is the whole of what exists today:
-- there is no period history, so no cycle can be measured, nothing can be
-- said about ovulation or a fertile window, and no bleeding pattern can be
-- recognised as clinically notable.
--
-- This migration adds the two tables that a real cycle tracker needs:
--
--   menstrual_cycles      one row per observed bleeding episode. Consecutive
--                         period_start_date values ARE the cycle history —
--                         cycle length is derived, never stored, so it cannot
--                         drift out of sync with the dates it comes from.
--   menstrual_daily_logs  one row per patient per day: flow, symptoms, mood.
--
-- reproductive_health_profiles is kept and is still the home of `life_stage`
-- (which drives the nudges and gates the postmenopausal-bleeding flag).
-- Its `last_period_date`/`average_cycle_length_days` columns become a seed and
-- a fallback for somebody with no logged history yet, not the source of
-- truth — deliberately NOT dropped, since the app still writes them and
-- removing a column in the same change that adds two tables would make a
-- rollback needlessly wide.
--
-- Row counts before this change (checked on the live project, 2026-09-02):
-- reproductive_health_profiles = 0 rows. So this is a purely structural
-- change with no data to convert, and no backfill step is missing.
--
-- Prediction, phase and clinical-flag logic all live in
-- apps/web/src/lib/rules/cycle-prediction.ts as a pure, unit-tested function,
-- NOT in the database — same split as bp-classification and findrisc, so the
-- rules can be reviewed and changed without a migration.
--
-- Cycle data is never fed into risk or escalation scoring. The clinical flags
-- the engine produces are read by a human, the same discipline
-- mental_health_screens and lifestyle_assessments follow.
--
-- Deliberately NOT collected: sexual activity. It is the most sensitive field
-- a cycle tracker can hold and the least clinically useful of the set here,
-- and consumer period apps have a poor record of containing it. If a future
-- fertility feature genuinely needs it, it should arrive as its own decision
-- with its own consent, not ride in on this table.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'menstrual_flow_level') then
    create type public.menstrual_flow_level as enum (
      'none', 'spotting', 'light', 'medium', 'heavy', 'flooding'
    );
  end if;
end $$;

comment on type public.menstrual_flow_level is
  'Patient-reported flow. ''flooding'' is the practical proxy for heavy '
  'menstrual bleeding (soaking through protection hourly, large clots) and is '
  'what the heavy-bleeding clinical flag counts.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'menstrual_symptom') then
    create type public.menstrual_symptom as enum (
      'cramps', 'headache', 'bloating', 'breast_tenderness', 'acne',
      'fatigue', 'nausea', 'back_pain', 'diarrhoea', 'constipation',
      'food_cravings', 'insomnia'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'menstrual_mood') then
    create type public.menstrual_mood as enum (
      'calm', 'happy', 'energetic', 'irritable', 'anxious', 'low', 'mood_swings'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- menstrual_cycles — observed bleeding episodes
-- ---------------------------------------------------------------------------

create table if not exists public.menstrual_cycles (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  period_start_date  date not null,
  -- Null while the period is still ongoing, or when the patient never
  -- recorded an end. The engine treats null as "unknown", not as "one day".
  period_end_date    date,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- One period per start date: a double-tap on "log period" is a duplicate,
  -- not a second period, and a duplicate would read as a zero-day cycle.
  unique (patient_id, period_start_date),
  constraint menstrual_cycles_end_after_start
    check (period_end_date is null or period_end_date >= period_start_date),
  -- A typo guard, NOT a clinical bound. It was originally 14 days, which was
  -- wrong in a way worth recording: prolonged bleeding is flagged by the
  -- engine at over 8 days, so a genuine three-week bleed -- precisely the
  -- abnormal uterine bleeding that flag exists to surface -- would have been
  -- refused at the database rather than recorded and escalated. A health
  -- record must never make a true observation impossible to enter. 30 days
  -- still catches the real error case (a mis-entered month or year), and the
  -- prediction engine separately excludes implausible durations from the
  -- "typical period length" average without discarding the row.
  constraint menstrual_cycles_plausible_duration
    check (period_end_date is null or period_end_date - period_start_date <= 30)
);

create index if not exists menstrual_cycles_patient_idx
  on public.menstrual_cycles (patient_id, period_start_date desc);
create index if not exists menstrual_cycles_org_idx
  on public.menstrual_cycles (organisation_id);

drop trigger if exists menstrual_cycles_set_updated_at on public.menstrual_cycles;
create trigger menstrual_cycles_set_updated_at
  before update on public.menstrual_cycles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- menstrual_daily_logs — one row per patient per day
-- ---------------------------------------------------------------------------

create table if not exists public.menstrual_daily_logs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  log_date         date not null,
  flow             public.menstrual_flow_level,
  symptoms         public.menstrual_symptom[] not null default '{}',
  moods            public.menstrual_mood[] not null default '{}',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (patient_id, log_date)
);

create index if not exists menstrual_daily_logs_patient_idx
  on public.menstrual_daily_logs (patient_id, log_date desc);
create index if not exists menstrual_daily_logs_org_idx
  on public.menstrual_daily_logs (organisation_id);

drop trigger if exists menstrual_daily_logs_set_updated_at on public.menstrual_daily_logs;
create trigger menstrual_daily_logs_set_updated_at
  before update on public.menstrual_daily_logs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — identical shape to reproductive_health_profiles, deliberately
--
-- Patient owns their own rows; org staff read within the org (this is
-- clinical data a care team needs when a bleeding pattern is the reason for
-- the consultation); a profile_access grantee reads, and a 'manage' grantee
-- writes, exactly as for the vaccination tables.
--
-- Note that org staff get SELECT only, never write: a cycle log is the
-- patient's own account of their body and staff must not edit it.
-- ---------------------------------------------------------------------------

alter table public.menstrual_cycles enable row level security;
alter table public.menstrual_daily_logs enable row level security;

create policy menstrual_cycles_select on public.menstrual_cycles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

create policy menstrual_cycles_insert on public.menstrual_cycles
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

create policy menstrual_cycles_update on public.menstrual_cycles
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  )
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

-- A mis-logged period start poisons every cycle length derived from it, so
-- unlike most clinical rows these are deletable by the person who wrote them.
create policy menstrual_cycles_delete on public.menstrual_cycles
  for delete to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

create policy menstrual_daily_logs_select on public.menstrual_daily_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

create policy menstrual_daily_logs_insert on public.menstrual_daily_logs
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

create policy menstrual_daily_logs_update on public.menstrual_daily_logs
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  )
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

create policy menstrual_daily_logs_delete on public.menstrual_daily_logs
  for delete to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

-- RLS restricts rows; it does not grant table-level access. A table created
-- by a plain migration does not inherit the grant Supabase provisions at
-- project creation, and the failure mode is an empty result rather than an
-- error — which is why this is explicit here as well as covered by the
-- alter-default-privileges migration.
grant select, insert, update, delete on public.menstrual_cycles to authenticated;
grant select, insert, update, delete on public.menstrual_daily_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — "built" should be provable, not hopeful
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  -- Both tables exist with RLS on.
  select string_agg(t, ', ') into v_missing
  from unnest(array['menstrual_cycles', 'menstrual_daily_logs']) as t
  where not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = t and rowsecurity
  );
  if v_missing is not null then
    raise exception 'menstrual cycle tables missing or RLS disabled: %', v_missing;
  end if;

  -- Every enum landed.
  select string_agg(t, ', ') into v_missing
  from unnest(array['menstrual_flow_level', 'menstrual_symptom', 'menstrual_mood']) as t
  where not exists (select 1 from pg_type where typname = t);
  if v_missing is not null then
    raise exception 'menstrual enums missing: %', v_missing;
  end if;

  -- authenticated can actually reach the tables (the empty-result failure
  -- mode this project has hit at least three times).
  if not has_table_privilege('authenticated', 'public.menstrual_cycles', 'SELECT')
     or not has_table_privilege('authenticated', 'public.menstrual_daily_logs', 'SELECT') then
    raise exception 'authenticated is missing SELECT on the menstrual cycle tables';
  end if;

  -- anon must reach neither.
  if has_table_privilege('anon', 'public.menstrual_cycles', 'SELECT')
     or has_table_privilege('anon', 'public.menstrual_daily_logs', 'SELECT') then
    raise exception 'anon can read menstrual cycle data';
  end if;

  -- Four policies on each table (select/insert/update/delete).
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'menstrual_cycles') <> 4 then
    raise exception 'menstrual_cycles should have exactly 4 policies';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'menstrual_daily_logs') <> 4 then
    raise exception 'menstrual_daily_logs should have exactly 4 policies';
  end if;
end $$;
