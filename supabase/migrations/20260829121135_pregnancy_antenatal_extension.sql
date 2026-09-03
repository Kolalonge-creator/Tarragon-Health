-- Tarragon Health — Women's Health platform, part 3: pregnancy + antenatal
-- tracking (§44.6/44.7).
--
-- patient_pregnancy (20260720180000) already carries is_pregnant/
-- estimated_due_date -- one row per patient (unique(patient_id)), a current-
-- status record, same "snapshot not history" design as
-- reproductive_health_profiles. This migration extends it with the two
-- fields antenatal tracking actually needs (last_menstrual_period_date, so
-- gestational week can be computed app-side the same way
-- lib/rules/cycle-nudges.ts computes an estimated next period -- a pure,
-- clearly-labelled estimate, never stored as a "confirmed" gestational age;
-- and high_risk/high_risk_notes for the care team to flag), and adds
-- antenatal_visits: the gestational-timeline tracking layer §44.7 asks for
-- (appointments, investigations, scans, vaccinations, warning symptoms,
-- education all "tracked").
--
-- Booking mechanics are deliberately NOT duplicated: an antenatal visit is
-- booked through the existing appointment engine
-- (hold_appointment_slot/confirm_appointment_booking, appointment_type 'gp'
-- or 'specialist', free-text service e.g. "Antenatal visit -- 28 weeks") and
-- linked here via appointment_id; investigations/scans/vaccinations already
-- have real homes (lab_orders/screen_types, vaccination_records) -- the
-- *_due columns here are a short checklist of what a visit still needs, not
-- a parallel booking system. Supplements/medications prescribed in pregnancy
-- are ordinary rows in the existing medications table -- no schema needed.
--
-- Self-report + staff-manage, same shape as vaccination_records and
-- patient_pregnancy itself: a patient can log their own antenatal visits
-- (many patients attend antenatal care and self-report it, same as
-- vaccinations), and org staff can create/update any.

create type public.antenatal_visit_status as enum ('scheduled', 'completed', 'missed', 'cancelled');

alter table public.patient_pregnancy
  add column if not exists last_menstrual_period_date date,
  add column if not exists high_risk boolean not null default false,
  add column if not exists high_risk_notes text;

comment on column public.patient_pregnancy.last_menstrual_period_date is
  'Self- or staff-reported LMP. Used app-side (lib/rules) to estimate gestational week -- always labelled an estimate, never a confirmed clinical dating.';
comment on column public.patient_pregnancy.high_risk is
  'Care-team-set flag (obstetric risk factors). Never inferred automatically -- same null/false-until-set discipline as doctor_tier.';

create table if not exists public.antenatal_visits (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  visit_number             smallint check (visit_number > 0),
  gestational_week_at_visit smallint check (gestational_week_at_visit between 0 and 45),
  appointment_id           uuid references public.appointments (id) on delete set null,
  status                   public.antenatal_visit_status not null default 'scheduled',
  investigations_due       text[] not null default '{}',
  scans_due                text[] not null default '{}',
  vaccinations_due         text[] not null default '{}',
  findings                 text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists antenatal_visits_patient_idx
  on public.antenatal_visits (patient_id, gestational_week_at_visit);
create index if not exists antenatal_visits_org_idx
  on public.antenatal_visits (organisation_id);

drop trigger if exists antenatal_visits_set_updated_at on public.antenatal_visits;
create trigger antenatal_visits_set_updated_at
  before update on public.antenatal_visits
  for each row execute function private.set_updated_at();

alter table public.antenatal_visits enable row level security;

drop policy if exists antenatal_visits_select on public.antenatal_visits;
create policy antenatal_visits_select on public.antenatal_visits
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = antenatal_visits.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

drop policy if exists antenatal_visits_insert on public.antenatal_visits;
create policy antenatal_visits_insert on public.antenatal_visits
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists antenatal_visits_update on public.antenatal_visits;
create policy antenatal_visits_update on public.antenatal_visits
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.antenatal_visits to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'patient_pregnancy' and column_name = 'last_menstrual_period_date') then
    raise exception 'patient_pregnancy.last_menstrual_period_date was not added';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'antenatal_visits') then
    raise exception 'antenatal_visits table was not created';
  end if;
  if has_table_privilege('anon', 'public.antenatal_visits', 'SELECT') then
    raise exception 'anon must not have access to antenatal_visits';
  end if;
  raise notice 'PASS: pregnancy/antenatal extension installed';
end $$;
