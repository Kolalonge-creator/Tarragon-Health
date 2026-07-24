-- Tarragon Health — Women's health bridge (life-stage + cycle nudges)
--
-- The "Women's Health" preventive_programmes track already exists and is
-- age/sex-recommended (2026-07-16), but enrolling in it only schedules a
-- generic periodic review — it isn't cervical-screening-specific, and there
-- is no cycle/life-stage nudge logic. The cervical/breast screening bridge
-- is read-only composition over the existing screen_types/screening_schedules
-- machinery (no schema needed for that half). This migration is the other
-- half: a self-reported reproductive life stage that drives a small,
-- honestly-labelled nudge engine (next-period estimate, pregnancy ->
-- antenatal booking, perimenopause/menopause -> care-team conversation) —
-- never a diagnosis, never fed into risk/escalation scoring, same
-- discipline as mental_health_screens and lifestyle_assessments.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reproductive_life_stage') then
    create type public.reproductive_life_stage as enum (
      'menstruating', 'trying_to_conceive', 'pregnant', 'postpartum',
      'perimenopausal', 'menopausal', 'not_applicable'
    );
  end if;
end $$;

create table if not exists public.reproductive_health_profiles (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  life_stage                  public.reproductive_life_stage not null default 'not_applicable',
  last_period_date            date,
  average_cycle_length_days   integer check (average_cycle_length_days between 15 and 60),
  updated_at                  timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  unique (patient_id)
);

create index if not exists reproductive_health_profiles_org_idx
  on public.reproductive_health_profiles (organisation_id);

drop trigger if exists reproductive_health_profiles_set_updated_at on public.reproductive_health_profiles;
create trigger reproductive_health_profiles_set_updated_at
  before update on public.reproductive_health_profiles
  for each row execute function private.set_updated_at();

alter table public.reproductive_health_profiles enable row level security;

-- Patient owns their own row (self-reported, like mental_health_screens'
-- read model but writable — this is a preference/log, not a scored
-- instrument); org staff read within the org; a profile_access 'manage'
-- grantee (e.g. a parent, once a teenager is old enough to menstruate but
-- still under a managed profile) may also read/write, same pattern as the
-- vaccination tables.
create policy reproductive_health_profiles_select on public.reproductive_health_profiles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = reproductive_health_profiles.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

create policy reproductive_health_profiles_insert on public.reproductive_health_profiles
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = reproductive_health_profiles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

create policy reproductive_health_profiles_update on public.reproductive_health_profiles
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = reproductive_health_profiles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  )
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = reproductive_health_profiles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

grant select, insert, update on public.reproductive_health_profiles to authenticated;
