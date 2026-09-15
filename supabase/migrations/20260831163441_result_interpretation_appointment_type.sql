-- Pay-per-service, Phase 3: a bookable "result interpretation session" needs
-- its own appointment_type — closest existing values (follow_up,
-- telemedicine) don't distinguish "doctor walks you through a specific lab
-- result" from a generic follow-up, and the clinician/patient-facing lists
-- filter and label by this enum. Same precedent as
-- 20260829132248_therapy_appointment_type_and_staff_flag.sql adding
-- 'therapy'. Split into its own migration/transaction because a freshly
-- added enum value cannot be referenced by DDL in the same transaction that
-- adds it (see 20260828000528_appointment_engine_types.sql's own note).

alter type public.appointment_type add value if not exists 'result_interpretation';
