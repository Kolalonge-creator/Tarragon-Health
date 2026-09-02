-- Patient Health Record architecture review — family_history as a genuine,
-- continuously-editable relational record (spec §1.9), founder-decided
-- (docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §3 Q4: promote, don't just
-- extend the existing intake).
--
-- WHAT THIS DOES NOT TOUCH
-- risk_assessment_responses (20260706084905_prevention_risk_assessment.sql)
-- already carries family_diabetes/family_hypertension/family_heart_disease/
-- family_sickle_cell/family_cancer_types[] — fixed presence/absence booleans
-- captured once at onboarding, feeding prevention_risk_scores. That scoring
-- pipeline is a real, working consumer of exactly that shape; migrating it
-- onto this new table would be a breaking change to prevention risk scoring
-- and the onboarding flow, which is not what was asked for. Those columns
-- and that scoring path are UNTOUCHED and remain the system of record for
-- "does this patient's family have condition X, yes/no, at onboarding."
--
-- family_history is the NEW, ADDITIONAL, continuously-editable record for
-- what that intake structurally cannot hold: relationship, approximate age
-- of onset, and deceased/alive — one row per (condition, relative), added
-- or corrected any time, not just at signup. A clinician reviewing a
-- patient's record reads both; neither is a duplicate of the other.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'family_relationship') then
    create type public.family_relationship as enum (
      'mother', 'father', 'sibling', 'child',
      'maternal_grandmother', 'maternal_grandfather',
      'paternal_grandmother', 'paternal_grandfather',
      'aunt_or_uncle', 'other'
    );
  end if;
end $$;

create table public.family_history (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  condition_name      text not null,
  relationship        public.family_relationship not null,
  relationship_detail text,
  age_of_onset_years  integer check (age_of_onset_years is null or age_of_onset_years between 0 and 120),
  is_deceased         boolean,
  source              text not null default 'patient' check (source in ('patient', 'clinician')),
  recorded_by         uuid references public.profiles (id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column public.family_history.relationship_detail is
  'Free-text refinement when relationship = other, or extra colour (e.g. "half-sibling") the enum does not capture.';
comment on column public.family_history.is_deceased is
  'Null = not asked / unknown. Never defaults to false — the spec is explicit that deceased/alive is only recorded "where known".';

create index family_history_patient_idx on public.family_history (patient_id);
create index family_history_org_idx on public.family_history (organisation_id);

create trigger family_history_set_updated_at
  before update on public.family_history
  for each row execute function private.set_updated_at();

alter table public.family_history enable row level security;

-- Same shape as patient_allergies: patient-reported by default, clinician
-- can also record/correct — family history is explicitly patient-sourced
-- data in the spec, not a restricted diagnosis.
create policy family_history_select on public.family_history
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy family_history_insert on public.family_history
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy family_history_update on public.family_history
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy family_history_delete on public.family_history
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.family_history to authenticated;
revoke all on public.family_history from anon;

-- Platform-wide audit + correction trail, same as every other clinical-core
-- table (see 20260812030853 and 20260827195333).
create trigger audit_row_change_trg
  after insert or update or delete on public.family_history
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.family_history
  for each row execute function private.capture_record_correction();

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'family_history') then
    raise exception 'FAIL: family_history table was not created';
  end if;
  raise notice 'PASS: family_history — table, RLS, and audit wiring installed';
end $$;
