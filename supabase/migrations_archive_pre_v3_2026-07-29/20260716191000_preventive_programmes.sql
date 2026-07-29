-- Tarragon Health — Preventive Health Pathway, Gap 2
-- Preventive programme catalogue + patient enrolment.
--
-- The preventive pathway's "programme selection" step. A preventive programme
-- is a named prevention *track* (Annual Health Check, Cardiometabolic
-- Prevention, Women's / Men's Health, Cancer Screening) that bundles a periodic
-- review cadence. It is deliberately NOT the à-la-carte "patient-initiated
-- wellness testing catalogue" (Phase 2/3, gated) — a patient enrols in a
-- prevention track, they do not order individual tests here.
--
-- preventive_programmes: global reference catalogue (no organisation_id), same
-- shape/ownership as screen_types / vaccination_catalog — any authenticated
-- user reads, admins write.
-- preventive_programme_enrolments: org-scoped, patient-visible; the patient may
-- self-enrol (the "selection" action) and staff may enrol/withdraw on their
-- behalf. Enrolling schedules the first periodic review (see Gap 3).

create table if not exists public.preventive_programmes (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  description      text,
  focus_areas      text[] not null default '{}',
  -- Periodic health-review cadence for enrolees (months). 12 = annual.
  review_cadence_months integer not null default 12 check (review_cadence_months > 0),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'preventive_enrolment_status') then
    create type public.preventive_enrolment_status as enum (
      'enrolled', 'completed', 'withdrawn'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'preventive_enrolment_source') then
    create type public.preventive_enrolment_source as enum ('recommended', 'self', 'staff');
  end if;
end;
$$;

create table if not exists public.preventive_programme_enrolments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  programme_id     uuid not null references public.preventive_programmes (id) on delete restrict,
  status           public.preventive_enrolment_status not null default 'enrolled',
  source           public.preventive_enrolment_source not null default 'self',
  enrolled_at      timestamptz not null default now(),
  withdrawn_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists preventive_enrolments_patient_idx
  on public.preventive_programme_enrolments (patient_id);
create index if not exists preventive_enrolments_org_idx
  on public.preventive_programme_enrolments (organisation_id, status);
-- At most one active enrolment per patient+programme.
create unique index if not exists preventive_enrolments_one_active
  on public.preventive_programme_enrolments (patient_id, programme_id)
  where status = 'enrolled';

drop trigger if exists preventive_enrolments_set_updated_at on public.preventive_programme_enrolments;
create trigger preventive_enrolments_set_updated_at
  before update on public.preventive_programme_enrolments
  for each row execute function private.set_updated_at();

-- --- RLS ---------------------------------------------------------------------
alter table public.preventive_programmes enable row level security;
alter table public.preventive_programme_enrolments enable row level security;

-- Catalogue: any authenticated user reads; admins write.
drop policy if exists preventive_programmes_select on public.preventive_programmes;
create policy preventive_programmes_select on public.preventive_programmes
  for select to authenticated using (true);
drop policy if exists preventive_programmes_insert on public.preventive_programmes;
create policy preventive_programmes_insert on public.preventive_programmes
  for insert to authenticated with check (private.is_admin());
drop policy if exists preventive_programmes_update on public.preventive_programmes;
create policy preventive_programmes_update on public.preventive_programmes
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
drop policy if exists preventive_programmes_delete on public.preventive_programmes;
create policy preventive_programmes_delete on public.preventive_programmes
  for delete to authenticated using (private.is_admin());

-- Enrolments: patient reads/writes own (self-enrol = the "selection" step);
-- org staff manage.
drop policy if exists preventive_enrolments_select on public.preventive_programme_enrolments;
create policy preventive_enrolments_select on public.preventive_programme_enrolments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists preventive_enrolments_insert on public.preventive_programme_enrolments;
create policy preventive_enrolments_insert on public.preventive_programme_enrolments
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists preventive_enrolments_update on public.preventive_programme_enrolments;
create policy preventive_enrolments_update on public.preventive_programme_enrolments
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.preventive_programmes to authenticated;
grant insert, update, delete on public.preventive_programmes to authenticated;
grant select, insert, update, delete on public.preventive_programme_enrolments to authenticated;

-- --- seed catalogue ----------------------------------------------------------
insert into public.preventive_programmes (code, name, description, focus_areas, review_cadence_months)
values
  ('annual_health_check', 'Annual Health Check',
   'A yearly top-to-toe check: vitals, core bloods, and a review with your care team.',
   array['vitals', 'bloods', 'lifestyle'], 12),
  ('cardiometabolic_prevention', 'Cardiometabolic Prevention',
   'Focused prevention for blood pressure, blood sugar, cholesterol and weight.',
   array['blood_pressure', 'diabetes', 'cholesterol', 'weight'], 6),
  ('womens_health', 'Women''s Health Screening',
   'Age-appropriate cervical, breast and reproductive-health screening.',
   array['cervical', 'breast', 'reproductive'], 12),
  ('mens_health', 'Men''s Health Screening',
   'Age-appropriate prostate and cardiometabolic screening for men.',
   array['prostate', 'cardiometabolic'], 12),
  ('cancer_screening', 'Cancer Screening',
   'Age-appropriate cancer screening (bowel, breast, cervical, prostate).',
   array['bowel', 'breast', 'cervical', 'prostate'], 12)
on conflict (code) do nothing;
