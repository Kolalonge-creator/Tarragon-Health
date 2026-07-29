-- Tarragon Health
-- Finish the nurse -> clinician rename left incomplete by
-- 20260705211611_merge_nurse_into_clinician.sql: that migration renamed the
-- table, indexes, trigger, and RLS policies, but Postgres does not
-- auto-rename a table's implicit primary-key/foreign-key constraint names on
-- ALTER TABLE ... RENAME TO, so clinician_alerts still carried
-- nurse_alerts_pkey / nurse_alerts_*_fkey. Pure renames, no behaviour change.

alter table public.clinician_alerts
  rename constraint nurse_alerts_pkey to clinician_alerts_pkey;

alter table public.clinician_alerts
  rename constraint nurse_alerts_organisation_id_fkey to clinician_alerts_organisation_id_fkey;

alter table public.clinician_alerts
  rename constraint nurse_alerts_patient_id_fkey to clinician_alerts_patient_id_fkey;

alter table public.clinician_alerts
  rename constraint nurse_alerts_acknowledged_by_fkey to clinician_alerts_acknowledged_by_fkey;
