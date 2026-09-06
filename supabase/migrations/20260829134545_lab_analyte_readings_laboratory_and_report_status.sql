-- Tarragon Health — Result Lifecycle §58.4 (Result representation): the
-- spec lists nine fields to store per result — test, value, unit, reference
-- range, interpretation, specimen date, result date, laboratory, report
-- status. lab_analyte_readings already carries seven of these (code, value,
-- unit, reference_range_low/high/text, abnormal_flag as the interpretation,
-- specimen_collected_at, taken_at/created_at) — `laboratory` (which lab
-- performed the test) and `report status` (preliminary/final/corrected/
-- amended) were never added at all. screening_results (the panel/qualitative
-- verdict — the ONLY row a qualitative/genotype/procedural result like HIV,
-- mammography, or sickle cell genotype ever produces, since those never
-- reach lab_analyte_readings at all) is missing `laboratory` too.
--
-- Pure additive schema only — deliberately NOT redefining
-- confirm_lab_report_extraction (20260807151847), a ~150-line function
-- already live in production. Wiring `laboratory` from
-- lab_report_templates.lab_name through that specific ingestion path is a
-- real, well-motivated follow-up (the data already exists one join away),
-- but hand-transcribing a function this size with no live database in this
-- environment to replay it against is exactly the kind of risk CLAUDE.md's
-- standing engineering lessons warn about. The manual-entry path
-- (submitScreeningResult, this session's own code) gets the field wired in
-- the companion app-layer commit instead, where the risk is well understood.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lab_report_status') then
    create type public.lab_report_status as enum ('preliminary', 'final', 'corrected', 'amended');
  end if;
end $$;

alter table public.lab_analyte_readings
  add column if not exists laboratory text,
  add column if not exists report_status public.lab_report_status not null default 'final';

alter table public.screening_results
  add column if not exists laboratory text;

comment on column public.lab_analyte_readings.laboratory is
  'Which lab performed the test, as reported on the source document — free text, never a generic/inferred value, same "store what was supplied" discipline as reference_range_text. Null means unknown, not "no lab" (e.g. some pre-existing rows predate this column).';
comment on column public.lab_analyte_readings.report_status is
  'preliminary/final/corrected/amended per Result Lifecycle §58.4. Defaults final: every current insert path (manual clinician entry, AI-extraction confirmation) already represents a completed, clinician-confirmed reading, never a preliminary one.';
comment on column public.screening_results.laboratory is
  'Which lab performed the test — the ONLY place this can be recorded for a qualitative/genotype/procedural result (HIV, mammography, sickle cell genotype, etc.), none of which ever produce a lab_analyte_readings row. Free text, same discipline as that column.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lab_report_status') then
    raise exception 'lab_report_status enum was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_analyte_readings' and column_name = 'laboratory'
  ) then
    raise exception 'lab_analyte_readings.laboratory was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_analyte_readings' and column_name = 'report_status'
  ) then
    raise exception 'lab_analyte_readings.report_status was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'screening_results' and column_name = 'laboratory'
  ) then
    raise exception 'screening_results.laboratory was not added';
  end if;
end $$;
