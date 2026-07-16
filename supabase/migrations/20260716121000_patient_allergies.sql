-- Tarragon Health — patient allergies (medication pathway, Phase 0)
--
-- No allergy data existed anywhere in the platform before this. The pharmacist
-- surface (Phase 8) and future prescribing-time safety checks (Phase 7+) both
-- need a place to read "what is this patient allergic to". Per the medication
-- pathway spec, BOTH the patient and org clinical staff can record an allergy
-- (patient self-report during onboarding; clinician-confirmed during review) —
-- so `source` distinguishes provenance and the patient may fully manage their
-- own rows, unlike medications where only a clinician may prescribe.
--
-- Every row is org-scoped (organisation_id) + RLS-gated like every other
-- multi-tenant table (CLAUDE.md Non-Negotiable Business Rules).

-- Enums guarded for idempotent re-apply (no CREATE TYPE IF NOT EXISTS).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'allergy_severity') then
    create type public.allergy_severity as enum ('mild', 'moderate', 'severe');
  end if;
  if not exists (select 1 from pg_type where typname = 'allergy_source') then
    create type public.allergy_source as enum ('patient', 'clinician');
  end if;
end $$;

create table if not exists public.patient_allergies (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  allergen          text not null,
  reaction          text,
  severity          public.allergy_severity,
  source            public.allergy_source not null default 'patient',
  recorded_by       uuid references public.profiles (id) on delete set null,
  noted_at          timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One row per (patient, allergen) — a duplicate allergen is an edit, not a
  -- second record. Case-insensitive de-dupe handled at the app layer.
  unique (patient_id, allergen)
);

create index if not exists patient_allergies_patient_idx on public.patient_allergies (patient_id);
create index if not exists patient_allergies_org_idx on public.patient_allergies (organisation_id);

drop trigger if exists patient_allergies_set_updated_at on public.patient_allergies;
create trigger patient_allergies_set_updated_at
  before update on public.patient_allergies
  for each row execute function private.set_updated_at();

alter table public.patient_allergies enable row level security;

-- Patient manages their own allergy list in full (add/edit/remove self-reported
-- entries); org clinical staff manage entries for patients in their org.
-- Policies dropped-then-created so a re-apply is idempotent.
drop policy if exists patient_allergies_select on public.patient_allergies;
create policy patient_allergies_select on public.patient_allergies
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists patient_allergies_insert on public.patient_allergies;
create policy patient_allergies_insert on public.patient_allergies
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists patient_allergies_update on public.patient_allergies;
create policy patient_allergies_update on public.patient_allergies
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists patient_allergies_delete on public.patient_allergies;
create policy patient_allergies_delete on public.patient_allergies
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_allergies to authenticated;
