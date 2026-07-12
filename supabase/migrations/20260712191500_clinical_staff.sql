-- Tarragon Health
-- clinical_staff: single source of truth for every named clinician shown
-- anywhere in the product (Clinical Director / Clinician / Escalation
-- Doctor) — docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4. Feeds the "Reviewed by
-- Dr. X" attribution component and the static "protocols supervised by"
-- badge; no UI may hardcode a clinician's name/photo/credential outside
-- this table.
--
-- profile_id links a clinical_staff record to the auth account that acts
-- as that clinician in the system (e.g. the doctor who resolves an
-- escalation) — nullable because a Clinical Director may exist as a
-- bio-only marketing record with no platform login.

create type public.clinical_staff_role as enum (
  'clinical_director', 'clinician', 'escalation_doctor'
);

create table public.clinical_staff (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  profile_id          uuid references public.profiles (id) on delete set null,
  role                public.clinical_staff_role not null,
  full_name           text not null,
  photo_url           text,
  credential_type     text,          -- 'MDCN' | 'NMCN'
  credential_number   text,
  specialty           text,
  bio                 text,
  active              boolean not null default true,
  license_verified_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint clinical_staff_profile_unique unique (profile_id)
);

create index clinical_staff_org_idx on public.clinical_staff (organisation_id);
create index clinical_staff_role_idx on public.clinical_staff (organisation_id, role) where active;
create index clinical_staff_profile_idx on public.clinical_staff (profile_id);

create trigger clinical_staff_set_updated_at
  before update on public.clinical_staff
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Read is org-wide including patients (not just staff): the whole point of
-- this table is patient/family-facing trust display — a patient must be
-- able to see their clinician's and Clinical Director's name/photo/bio.
-- Only org staff may write.
-- ---------------------------------------------------------------------------

alter table public.clinical_staff enable row level security;

create policy clinical_staff_select on public.clinical_staff
  for select to authenticated
  using (
    organisation_id = private.current_org_id()
    or private.is_org_staff(organisation_id)
  );

create policy clinical_staff_insert on public.clinical_staff
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy clinical_staff_update on public.clinical_staff
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy clinical_staff_delete on public.clinical_staff
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.clinical_staff to authenticated;
