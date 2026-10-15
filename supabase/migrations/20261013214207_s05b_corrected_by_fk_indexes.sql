-- S05b follow-up: the corrected_by foreign key added by 20261013184219 to the four correction tables had no covering index.
-- sr2c_hot_table_indexes_and_initplan requires every foreign key on vitals_readings (a hot table) to be covered, and a delete of a profile
-- scans each referencing table for the ON DELETE SET NULL action. Live row counts today: vitals_readings 12, the others 0; the indexes are
-- tiny and partial (only corrected rows carry a value), so the cost is nil. IF NOT EXISTS so a replay or a manual earlier fix is harmless.

create index if not exists vitals_readings_corrected_by_fk_idx on public.vitals_readings (corrected_by) where corrected_by is not null;
create index if not exists patient_allergies_corrected_by_fk_idx on public.patient_allergies (corrected_by) where corrected_by is not null;
create index if not exists patient_conditions_corrected_by_fk_idx on public.patient_conditions (corrected_by) where corrected_by is not null;
create index if not exists lab_analyte_readings_corrected_by_fk_idx on public.lab_analyte_readings (corrected_by) where corrected_by is not null;

do $$
declare t text;
begin
  foreach t in array array['vitals_readings', 'patient_allergies', 'patient_conditions', 'lab_analyte_readings'] loop
    if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = t and indexname = t || '_corrected_by_fk_idx') then
      raise exception '% corrected_by index missing', t;
    end if;
  end loop;
end $$;
