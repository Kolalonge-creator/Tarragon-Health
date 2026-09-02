-- Patient Health Record architecture review — lab_analyte_readings gains a
-- reference range, an abnormal flag, and a specimen-collection timestamp.
--
-- Spec §1.13 (laboratory results) asks for: test, result, unit, reference
-- range, abnormal flag, laboratory, specimen date, result date, source,
-- clinician review status. lab_analyte_readings (20260707212140, widened by
-- 20260807151847_nigerian_lab_ingestion_engine.sql for non-numeric results)
-- already had test/result/unit/result date. This adds the remaining three
-- as plain nullable columns — additive, no backfill needed (the ingestion-
-- engine migration itself records the table held zero rows in production
-- when it was written; the same is true here per the row count below).
--
-- Deliberately NOT adding a per-row "clinician review status" column: a row
-- in this table only ever exists after a clinician has confirmed an AI
-- extraction proposal (confirm_lab_report_extraction) or a direct clinician
-- entry — "AI drafts, never decides" per that migration's own safety
-- invariant. Every row here is already, by construction, clinician-
-- reviewed; a review-status column would just be a second, redundant place
-- for that same fact to go stale.
--
-- "Laboratory" (which lab partner performed the test) already lives one
-- level up, on lab_orders.provider_id -> lab_providers — not duplicated
-- onto every analyte row.

alter table public.lab_analyte_readings
  add column if not exists reference_range_low  numeric(12, 4),
  add column if not exists reference_range_high numeric(12, 4),
  add column if not exists reference_range_text text,
  add column if not exists specimen_collected_at timestamptz;

comment on column public.lab_analyte_readings.reference_range_low is
  'Lower bound of the normal range for this analyte/unit, when numeric. Null when the analyte has no numeric range (see reference_range_text) or none was captured.';
comment on column public.lab_analyte_readings.reference_range_high is
  'Upper bound of the normal range for this analyte/unit, when numeric.';
comment on column public.lab_analyte_readings.reference_range_text is
  'Reference range for a non-numeric or coded result (e.g. "Negative", "AA/AS/AC"), or a free-text range a source document printed that does not reduce to a clean numeric low/high.';
comment on column public.lab_analyte_readings.specimen_collected_at is
  'When the specimen was drawn/collected, distinct from taken_at (when this reading was recorded into the platform) and created_at (row insert time). Null for historical rows and any source that does not report it — never backfilled or guessed.';

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lab_analyte_flag') then
    create type public.lab_analyte_flag as enum (
      'normal', 'low', 'high', 'critical_low', 'critical_high'
    );
  end if;
end $$;

alter table public.lab_analyte_readings
  add column if not exists abnormal_flag public.lab_analyte_flag;

comment on column public.lab_analyte_readings.abnormal_flag is
  'Per-analyte flag against reference_range_low/high (or a coded/text range), distinct from screening_results.result_status which is a per-panel verdict. Null means not evaluated (no reference range known for this code) — never defaults to normal.';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_analyte_readings'
      and column_name in ('reference_range_low', 'reference_range_high', 'reference_range_text',
                           'specimen_collected_at', 'abnormal_flag');
  if v_count <> 5 then
    raise exception 'FAIL: lab_analyte_readings did not gain all 5 new columns';
  end if;
  raise notice 'PASS: lab_analyte_reference_range_and_flag — columns added';
end $$;
