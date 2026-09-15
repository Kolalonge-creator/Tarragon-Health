-- Tarragon Health — Women's Health platform, part 5: postnatal programme
-- (§44.9).
--
-- patient_pregnancy is a current-status snapshot (unique(patient_id)), not a
-- history -- it cannot hold "delivery happened on date X" without losing the
-- ability to represent a later pregnancy. postnatal_profiles is therefore its
-- own table, one row per delivery, so a patient's postnatal history survives
-- across however many pregnancies they log over time. The patient-facing
-- transition ("I delivered") sets patient_pregnancy.is_pregnant = false (via
-- the existing setPregnancyStatus action) and inserts one postnatal_profiles
-- row -- app-layer glue, no new trigger needed for that hand-off.
--
-- Maternal recovery, breastfeeding support and contraception follow-up are
-- tracked per postnatal_checkins row (week 1 / week 6 / month 3 / month 6 /
-- month 12, matching typical postnatal review cadences). Mental wellbeing
-- screening reuses mental_health_screens (20260719144000) rather than a new
-- table -- this migration adds the Edinburgh Postnatal Depression Scale
-- ('epds') as a fourth instrument alongside phq9/gad7/auditc, same
-- crisis-routing discipline (item 10 is EPDS's self-harm question, scored
-- app-side exactly like PHQ-9 item 9). Routine follow-up is an ordinary
-- appointment via the existing appointment engine, linked by appointment_id.

create type public.breastfeeding_status as enum ('not_started', 'exclusive', 'mixed', 'formula_only', 'stopped');

create table if not exists public.postnatal_profiles (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  delivery_date    date not null,
  delivery_mode    text check (delivery_mode in ('vaginal', 'assisted', 'caesarean', 'unknown')) not null default 'unknown',
  complications    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists postnatal_profiles_patient_idx
  on public.postnatal_profiles (patient_id, delivery_date desc);
create index if not exists postnatal_profiles_org_idx
  on public.postnatal_profiles (organisation_id);

drop trigger if exists postnatal_profiles_set_updated_at on public.postnatal_profiles;
create trigger postnatal_profiles_set_updated_at
  before update on public.postnatal_profiles
  for each row execute function private.set_updated_at();

alter table public.postnatal_profiles enable row level security;

-- Access-control correction (2026-09-02, pre-launch security review): removed
-- the caregiver EXISTS branch that originally sat here -- ANY profile_access
-- grantee, any category, could read a patient's delivery/postnatal record.
-- postnatal_profiles/postnatal_checkins extend patient_pregnancy
-- (20260720180000), whose own SELECT policy has never had a caregiver branch
-- at all; this table was never applied live, so the fix is made directly
-- rather than shipped-then-patched. See 20260829121135_pregnancy_antenatal_
-- extension.sql's header for the full reasoning (same correction, same table
-- family).
drop policy if exists postnatal_profiles_select on public.postnatal_profiles;
create policy postnatal_profiles_select on public.postnatal_profiles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists postnatal_profiles_insert on public.postnatal_profiles;
create policy postnatal_profiles_insert on public.postnatal_profiles
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists postnatal_profiles_update on public.postnatal_profiles;
create policy postnatal_profiles_update on public.postnatal_profiles
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.postnatal_profiles to authenticated;

create table if not exists public.postnatal_checkins (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  postnatal_profile_id    uuid not null references public.postnatal_profiles (id) on delete cascade,
  checkin_window          text not null check (checkin_window in ('week_1', 'week_6', 'month_3', 'month_6', 'month_12', 'other')),
  scheduled_date          date,
  completed_at            timestamptz,
  maternal_recovery_notes text,
  breastfeeding_status    public.breastfeeding_status,
  contraception_discussed boolean not null default false,
  mental_health_screen_id uuid references public.mental_health_screens (id) on delete set null,
  appointment_id          uuid references public.appointments (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists postnatal_checkins_profile_idx
  on public.postnatal_checkins (postnatal_profile_id);
create index if not exists postnatal_checkins_patient_idx
  on public.postnatal_checkins (patient_id);
create index if not exists postnatal_checkins_org_idx
  on public.postnatal_checkins (organisation_id);

drop trigger if exists postnatal_checkins_set_updated_at on public.postnatal_checkins;
create trigger postnatal_checkins_set_updated_at
  before update on public.postnatal_checkins
  for each row execute function private.set_updated_at();

alter table public.postnatal_checkins enable row level security;

drop policy if exists postnatal_checkins_select on public.postnatal_checkins;
create policy postnatal_checkins_select on public.postnatal_checkins
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists postnatal_checkins_insert on public.postnatal_checkins;
create policy postnatal_checkins_insert on public.postnatal_checkins
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists postnatal_checkins_update on public.postnatal_checkins;
create policy postnatal_checkins_update on public.postnatal_checkins
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.postnatal_checkins to authenticated;

-- ---------------------------------------------------------------------------
-- EPDS as a fourth mental_health_screens instrument (postnatal mental
-- wellbeing screening, §44.9). Same table, same service-role-write-only,
-- crisis-flagged-item discipline as phq9/gad7/auditc -- see
-- 20260719144000_mental_health_screens.sql's header. The CHECK constraint
-- Postgres auto-named on that inline column definition is
-- mental_health_screens_instrument_check.
-- ---------------------------------------------------------------------------
alter table public.mental_health_screens
  drop constraint if exists mental_health_screens_instrument_check;
alter table public.mental_health_screens
  add constraint mental_health_screens_instrument_check
  check (instrument in ('phq9', 'gad7', 'auditc', 'epds'));

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'postnatal_profiles') then
    raise exception 'postnatal_profiles table was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'postnatal_checkins') then
    raise exception 'postnatal_checkins table was not created';
  end if;
  if has_table_privilege('anon', 'public.postnatal_profiles', 'SELECT') or has_table_privilege('anon', 'public.postnatal_checkins', 'SELECT') then
    raise exception 'anon must not have access to postnatal tables';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('postnatal_profiles', 'postnatal_checkins')
      and policyname like '%_select' and coalesce(qual,'') ilike '%profile_access%'
  ) then
    raise exception 'postnatal_profiles/postnatal_checkins select policies must not reference profile_access -- no caregiver access, matching patient_pregnancy';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'mental_health_screens_instrument_check'
      and conrelid = 'public.mental_health_screens'::regclass
      and pg_get_constraintdef(oid) like '%epds%'
  ) then
    raise exception 'mental_health_screens_instrument_check does not accept epds';
  end if;
  raise notice 'PASS: postnatal programme installed, mental_health_screens accepts epds';
end $$;
