-- W-25b: validate the two measurement_context checks that 20261027192319 added NOT VALID.
-- Why a separate file: VALIDATE CONSTRAINT scans the table. Run in the same transaction as the ALTER TABLE ADD COLUMN it would hold the ACCESS EXCLUSIVE lock of that
-- ALTER across the scans. Here, in its own transaction, it takes only SHARE UPDATE EXCLUSIVE (reads and writes continue). The column is all null at this point (no
-- backfill), so both checks are trivially satisfied and the scans only confirm it.
alter table public.vitals_readings validate constraint vitals_readings_measurement_context_check;
alter table public.vitals_readings validate constraint vitals_readings_measurement_context_origin_check;

do $assert$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.vitals_readings'::regclass
               and conname in ('vitals_readings_measurement_context_check', 'vitals_readings_measurement_context_origin_check') and not convalidated) then
    raise exception 'W25b: a measurement_context check is still not validated';
  end if;
end
$assert$;
