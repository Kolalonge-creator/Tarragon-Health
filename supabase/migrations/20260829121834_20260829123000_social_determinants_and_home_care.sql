-- Healthy Ageing & Elderly Care — social determinants (spec §50.12) and
-- home-based care (spec §50.13).
--
-- SOCIAL DETERMINANTS: the spec is explicit that these "should trigger
-- support/navigation rather than become merely demographic data" — so
-- needs_navigation_support is a generated column (can't be forgotten or
-- silently left off a select list) and follow_up_status is server-computed
-- from the flags on insert, never client-set, so a screening with any flag
-- true is never filed as nothing-to-do.
--
-- HOME-BASED CARE: scoped deliberately narrow. Tarragon has no live home-visit
-- clinical-service partner today (home_visit_providers, from the 2026-07-15
-- logistics migration, is scoped to lab-sample collection only, seeded with
-- zero active rows). Building real dispatch/logistics against a partner that
-- doesn't exist yet is the same kind of speculative business/regulatory
-- commitment CLAUDE.md already flags for device bundling — so this table is
-- internal record-keeping and a care-coordinator workflow only: eligibility
-- screening through to a coordinator-arranged visit, tracked as data. Wiring
-- it to a real external provider is future work once one exists.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'social_navigation_follow_up_status') then
    create type public.social_navigation_follow_up_status as enum (
      'none_needed', 'pending', 'contacted', 'resolved'
    );
  end if;
end $$;

create table if not exists public.social_determinant_screenings (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  ageing_assessment_id          uuid references public.ageing_assessments (id) on delete set null,
  logged_by_profile_id          uuid references public.profiles (id) on delete set null,

  living_alone                  boolean not null default false,
  transport_difficulty          boolean not null default false,
  financial_barrier             boolean not null default false,
  caregiver_limitation          boolean not null default false,
  healthcare_access_difficulty  boolean not null default false,

  needs_navigation_support boolean generated always as (
    living_alone or transport_difficulty or financial_barrier
    or caregiver_limitation or healthcare_access_difficulty
  ) stored,

  -- Server-computed on insert (see trigger below), never client-set: a flag
  -- can never be filed as "no follow-up needed" by omission.
  follow_up_status              public.social_navigation_follow_up_status not null default 'none_needed',
  coordinator_notes             text,
  followed_up_by                uuid references public.profiles (id) on delete set null,
  followed_up_at                timestamptz,

  screened_at                   timestamptz not null default now(),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

comment on column public.social_determinant_screenings.logged_by_profile_id is
  'Who completed this, when that is not the patient. NULL = the patient themselves. Server-derived, never client-supplied.';

create index if not exists social_determinant_screenings_patient_idx
  on public.social_determinant_screenings (patient_id, screened_at desc);
create index if not exists social_determinant_screenings_org_idx
  on public.social_determinant_screenings (organisation_id);
create index if not exists social_determinant_screenings_pending_idx
  on public.social_determinant_screenings (organisation_id)
  where follow_up_status = 'pending';

drop trigger if exists social_determinant_screenings_set_updated_at on public.social_determinant_screenings;
create trigger social_determinant_screenings_set_updated_at
  before update on public.social_determinant_screenings
  for each row execute function private.set_updated_at();

drop trigger if exists stamp_acting_supporter on public.social_determinant_screenings;
create trigger stamp_acting_supporter
  before insert on public.social_determinant_screenings
  for each row execute function private.stamp_acting_supporter('patient_id');

create or replace function private.default_social_navigation_follow_up()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.living_alone or new.transport_difficulty or new.financial_barrier
      or new.caregiver_limitation or new.healthcare_access_difficulty) then
    new.follow_up_status := 'pending';
  else
    new.follow_up_status := 'none_needed';
  end if;
  return new;
end;
$$;

drop trigger if exists social_determinant_screenings_default_follow_up on public.social_determinant_screenings;
create trigger social_determinant_screenings_default_follow_up
  before insert on public.social_determinant_screenings
  for each row execute function private.default_social_navigation_follow_up();

alter table public.social_determinant_screenings enable row level security;

drop policy if exists social_determinant_screenings_select on public.social_determinant_screenings;
create policy social_determinant_screenings_select on public.social_determinant_screenings
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

-- Append-only from the patient/caregiver side, same as vitals/symptom logs —
-- a changed situation is a new screening, not an edit to an old one.
drop policy if exists social_determinant_screenings_insert on public.social_determinant_screenings;
create policy social_determinant_screenings_insert on public.social_determinant_screenings
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or private.can_act_for(patient_id)
    or private.is_org_staff(organisation_id)
  );

-- Only org staff (the care coordinator working the queue) may update —
-- resolving follow-up, adding notes.
drop policy if exists social_determinant_screenings_update on public.social_determinant_screenings;
create policy social_determinant_screenings_update on public.social_determinant_screenings
  for update using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.social_determinant_screenings to authenticated;
revoke all on public.social_determinant_screenings from anon;

-- ---------------------------------------------------------------------------
-- Home-based care (spec §50.13) — internal eligibility + coordinator record.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'home_care_request_status') then
    create type public.home_care_request_status as enum (
      'eligibility_pending', 'eligible', 'ineligible', 'scheduled', 'visit_completed', 'declined'
    );
  end if;
end $$;

create table if not exists public.home_care_requests (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  logged_by_profile_id     uuid references public.profiles (id) on delete set null,

  reason                   text,
  status                   public.home_care_request_status not null default 'eligibility_pending',

  eligibility_notes        text,
  eligibility_checked_by   uuid references public.profiles (id) on delete set null,
  eligibility_checked_at   timestamptz,

  assigned_clinician_id    uuid references public.profiles (id) on delete set null,
  scheduled_at             timestamptz,
  visit_notes              text,
  visit_completed_at       timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on column public.home_care_requests.logged_by_profile_id is
  'Who raised this, when that is not the patient. NULL = the patient themselves. Server-derived, never client-supplied.';
comment on table public.home_care_requests is
  'Internal eligibility screening + care-coordinator workflow only — no live external home-visit partner is wired up yet (home_visit_providers is lab-sample-collection scoped). Do not build dispatch/logistics against a real provider here without an explicit ask.';

create index if not exists home_care_requests_patient_idx
  on public.home_care_requests (patient_id, created_at desc);
create index if not exists home_care_requests_org_idx
  on public.home_care_requests (organisation_id);
create index if not exists home_care_requests_open_idx
  on public.home_care_requests (organisation_id, status)
  where status not in ('visit_completed', 'declined');

drop trigger if exists home_care_requests_set_updated_at on public.home_care_requests;
create trigger home_care_requests_set_updated_at
  before update on public.home_care_requests
  for each row execute function private.set_updated_at();

drop trigger if exists stamp_acting_supporter on public.home_care_requests;
create trigger stamp_acting_supporter
  before insert on public.home_care_requests
  for each row execute function private.stamp_acting_supporter('patient_id');

alter table public.home_care_requests enable row level security;

drop policy if exists home_care_requests_select on public.home_care_requests;
create policy home_care_requests_select on public.home_care_requests
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists home_care_requests_insert on public.home_care_requests;
create policy home_care_requests_insert on public.home_care_requests
  for insert to authenticated
  with check (
    (
      (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
      and status = 'eligibility_pending'
    )
    or private.is_org_staff(organisation_id)
  );

-- Progressing eligibility/scheduling/visit outcome is coordinator work.
drop policy if exists home_care_requests_update on public.home_care_requests;
create policy home_care_requests_update on public.home_care_requests
  for update using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.home_care_requests to authenticated;
revoke all on public.home_care_requests from anon;

-- ===========================================================================
-- Proof, not hope.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'social_determinant_screenings'
      and column_name = 'needs_navigation_support' and is_generated = 'ALWAYS'
  ) then
    raise exception 'social_determinant_screenings.needs_navigation_support must be a generated column';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'home_care_requests' and policyname = 'home_care_requests_update'
  ) then
    raise exception 'home_care_requests update policy missing';
  end if;
end $$;
