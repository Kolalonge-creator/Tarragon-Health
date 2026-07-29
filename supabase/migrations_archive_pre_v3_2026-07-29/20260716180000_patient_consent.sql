-- Tarragon Health — Patient onboarding, Phase A
-- Consent capture + a DB-enforced onboarding prerequisite gate.
--
-- Two compliance gaps are closed here (docs/CLINICAL_TRUST_MODEL_SPEC.md §5
-- "Consent screen honesty", NDPR data-processing basis):
--   1. Explicit, versioned, append-only consent capture — we record the exact
--      text a patient agreed to, not just a boolean.
--   2. A structural guarantee that a patient account cannot reach the
--      dashboard (onboarding_completed_at set) without (a) recording the
--      current required consents and (b) supplying demographics (DOB + sex)
--      that the age/sex-dependent risk + screening engines need.
--
-- profiles.sex + profiles.date_of_birth already exist
-- (20260705211044_core_auth_multitenancy.sql) — this migration only adds the
-- consent tables + the gate, it does not add demographic columns.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'consent_type') then
    create type public.consent_type as enum (
      'data_processing', 'telehealth', 'terms_of_service'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- consent_versions — append-only catalogue of the exact consent text a
-- patient agreed to. is_current marks the version every new patient must
-- accept. Admin-managed; globally readable so the UI can render the copy.
-- ---------------------------------------------------------------------------

create table if not exists public.consent_versions (
  id            uuid primary key default gen_random_uuid(),
  consent_type  public.consent_type not null,
  version       text not null,
  title         text not null,
  body          text not null,
  is_current    boolean not null default true,
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (consent_type, version)
);

-- At most one current version per consent type.
create unique index if not exists consent_versions_one_current
  on public.consent_versions (consent_type)
  where is_current;

-- ---------------------------------------------------------------------------
-- patient_consents — append-only record of a patient accepting a specific
-- consent version. Never updated or deleted (same audit posture as
-- protocol_versions); withdrawing consent is a new row of a future
-- "withdrawn" shape, not a mutation of history.
-- ---------------------------------------------------------------------------

create table if not exists public.patient_consents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  consent_type       public.consent_type not null,
  consent_version_id uuid not null references public.consent_versions (id) on delete restrict,
  version            text not null,
  accepted_at        timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists patient_consents_patient_idx on public.patient_consents (patient_id);
create index if not exists patient_consents_org_idx on public.patient_consents (organisation_id);
create index if not exists patient_consents_version_idx on public.patient_consents (consent_version_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.consent_versions enable row level security;
alter table public.patient_consents enable row level security;

drop policy if exists consent_versions_select on public.consent_versions;
create policy consent_versions_select on public.consent_versions
  for select to authenticated using (true);

drop policy if exists consent_versions_admin_write on public.consent_versions;
create policy consent_versions_admin_write on public.consent_versions
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- Patient inserts + reads own consents; org staff read. No update/delete
-- policy at all — the table is append-only by design.
drop policy if exists patient_consents_select on public.patient_consents;
create policy patient_consents_select on public.patient_consents
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_consents_insert on public.patient_consents;
create policy patient_consents_insert on public.patient_consents
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

grant select, insert, update, delete on public.consent_versions to authenticated;
grant select, insert on public.patient_consents to authenticated;

-- ---------------------------------------------------------------------------
-- has_required_consents(patient): true when the patient has an acceptance row
-- for every currently-required consent version. Security definer so it can be
-- called from the profiles gate trigger below without tripping RLS recursion.
-- ---------------------------------------------------------------------------

create or replace function private.has_required_consents(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.consent_versions cv
    where cv.is_current
      and not exists (
        select 1
        from public.patient_consents pc
        where pc.patient_id = p_patient
          and pc.consent_version_id = cv.id
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Gate: a patient row cannot flip onboarding_completed_at from null -> set
-- unless demographics (DOB + sex) are present and all required consents are
-- recorded. This is the structural backstop behind the app-layer onboarding
-- ordering — even a spoofed direct update is rejected. Mirrors the
-- enforce_medication_confirm_only / indemnity trigger pattern.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_onboarding_prereqs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.onboarding_completed_at is not null
     and old.onboarding_completed_at is null
     and new.role = 'patient' then
    if new.date_of_birth is null or new.sex is null then
      raise exception 'Onboarding cannot complete without date of birth and sex on file'
        using errcode = 'check_violation';
    end if;
    if not private.has_required_consents(new.id) then
      raise exception 'Onboarding cannot complete without accepting the required consents'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_onboarding_prereqs on public.profiles;
create trigger profiles_enforce_onboarding_prereqs
  before update on public.profiles
  for each row execute function private.enforce_onboarding_prereqs();

-- ---------------------------------------------------------------------------
-- Seed the launch consent versions. Copy is plain-language and honest per the
-- brand voice; it should still be reviewed by counsel before public launch.
-- ---------------------------------------------------------------------------

insert into public.consent_versions (consent_type, version, title, body, is_current)
values
  (
    'data_processing', '2026-07-v1', 'How we use your health information',
    'You agree that TarragonHealth may collect and store your health information — the readings, results, medicines and answers you share — to coordinate your care and show it to the care team looking after you. We keep it secure, we do not sell it, and you can ask us to export or delete it at any time. Your data is processed on the lawful basis of your consent and the delivery of care you have asked us for.',
    true
  ),
  (
    'telehealth', '2026-07-v1', 'Consent to remote care',
    'You agree to receive care and clinical review from TarragonHealth doctors and care team remotely — through the app, web, and follow-up messages. Remote care has limits: in an emergency, call your local emergency service or go to the nearest hospital. You can withdraw from remote care at any time.',
    true
  ),
  (
    'terms_of_service', '2026-07-v1', 'Terms of service',
    'You agree to use TarragonHealth for your own care or the care of family members you are responsible for, to give accurate information, and to follow the guidance your care team provides. TarragonHealth coordinates your care with doctors, labs and pharmacies — it does not replace emergency services.',
    true
  )
on conflict (consent_type, version) do nothing;
