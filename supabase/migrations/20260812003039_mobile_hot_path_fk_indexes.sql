-- Covering indexes for foreign keys on the tables the mobile app's sync
-- paths (HealthKit/Health Connect/BLE ingestion, vitals logging, care
-- messaging, clinician escalation) write and read most, flagged by the
-- Supabase performance advisor as missing a covering index. Additive only,
-- no behaviour change -- these are the columns RLS and the app's own
-- queries already filter/join on, so this only helps query plans as row
-- counts grow past a full-table-scan-friendly size.

create index if not exists care_messages_organisation_id_idx
  on public.care_messages (organisation_id);

create index if not exists care_messages_patient_id_idx
  on public.care_messages (patient_id);

create index if not exists care_messages_author_profile_id_idx
  on public.care_messages (author_profile_id);

create index if not exists care_messages_actor_clinical_staff_id_idx
  on public.care_messages (actor_clinical_staff_id);

create index if not exists care_message_threads_created_by_idx
  on public.care_message_threads (created_by);

create index if not exists clinician_alerts_screening_result_id_idx
  on public.clinician_alerts (screening_result_id);

create index if not exists clinician_alerts_vital_reading_id_idx
  on public.clinician_alerts (vital_reading_id);

create index if not exists medication_logs_logged_by_profile_id_idx
  on public.medication_logs (logged_by_profile_id);

create index if not exists vitals_readings_logged_by_profile_id_idx
  on public.vitals_readings (logged_by_profile_id);

create index if not exists annual_health_checks_reviewed_by_idx
  on public.annual_health_checks (reviewed_by);
