-- Tarragon Health — Sprint 4 Week 9
-- Lab analyte reading history
--
-- Nothing before this migration stores an individual lab value over time:
-- screening_results only keeps result_status/abnormal_flags/summary (the
-- ML-derived verdict), not the raw value, and HbA1c isn't a self-logged
-- vital like glucose is (vitals_readings has no analyte columns). The ML
-- service's /trajectory/hba1c endpoint needs a dated value history to fit a
-- trend against — this table is that history, staff-authored (a clinician
-- or lab result submission writes it), populated alongside each
-- screening_results insert for every analyte in that submission.
--
-- `code` intentionally stays `text`, not a Postgres enum: it must accept
-- whatever `AnalyteCode` the Python service currently supports
-- (services/ml/app/scoring/lab_reference.py) without a migration every time
-- that list grows.

create table public.lab_analyte_readings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  code              text not null,
  value             numeric(8, 3) not null,
  unit              text not null,
  taken_at          timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index lab_analyte_readings_patient_code_idx
  on public.lab_analyte_readings (patient_id, code, taken_at desc);
create index lab_analyte_readings_org_idx on public.lab_analyte_readings (organisation_id);

alter table public.lab_analyte_readings enable row level security;

-- Same clinician-authored pattern as patient_risk_scores
-- (20260705000002_chronic_disease.sql): patient reads their own rows,
-- writes are staff-only since this is a system/clinician-recorded value,
-- never a patient's own raw input.
create policy lab_analyte_readings_select on public.lab_analyte_readings
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy lab_analyte_readings_insert on public.lab_analyte_readings
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy lab_analyte_readings_update on public.lab_analyte_readings
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy lab_analyte_readings_delete on public.lab_analyte_readings
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.lab_analyte_readings to authenticated;
