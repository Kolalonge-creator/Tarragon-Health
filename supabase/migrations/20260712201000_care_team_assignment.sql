-- Tarragon Health
-- care_team_assignment: powers the patient-facing "Your Care Team" card and
-- the onboarding trust surface — docs/CLINICAL_TRUST_MODEL_SPEC.md §2/§4.
-- One row per patient (upserted on reassignment, not appended), since a
-- patient always has exactly one current clinician/director pairing —
-- assigned_at is overwritten to now() by the app on every reassignment, so
-- no separate created_at/updated_at pair is needed.
--
-- clinician_id / clinical_director_id reference profiles (the auth account),
-- matching every other assignment-style FK in this schema (e.g.
-- escalations.assigned_doctor_id) — the corresponding clinical_staff record
-- (name/photo/credential) is looked up via clinical_staff.profile_id at
-- display time, same join pattern as ReviewedByDoctor.

create table public.care_team_assignment (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  clinician_id          uuid references public.profiles (id) on delete set null,
  clinical_director_id  uuid references public.profiles (id) on delete set null,
  assigned_at           timestamptz not null default now(),
  constraint care_team_assignment_patient_unique unique (patient_id)
);

create index care_team_assignment_org_idx on public.care_team_assignment (organisation_id);
create index care_team_assignment_clinician_idx on public.care_team_assignment (clinician_id);

alter table public.care_team_assignment enable row level security;

create policy care_team_assignment_select on public.care_team_assignment
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy care_team_assignment_insert on public.care_team_assignment
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy care_team_assignment_update on public.care_team_assignment
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy care_team_assignment_delete on public.care_team_assignment
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.care_team_assignment to authenticated;
