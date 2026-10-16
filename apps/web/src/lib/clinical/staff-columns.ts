/**
 * Every public.clinical_staff column EXCEPT credential_number (the MDCN folio).
 *
 * CMO decision OQ-358: once the base table is locked (step 2, migration `clinical_staff_folio_lock`),
 * `authenticated` holds SELECT on exactly this column list. `select("*")` and any select that names
 * credential_number then fails with "permission denied", so every screen that reads the table lists its
 * columns (or uses this constant) and gets the folio, if it is entitled to it, through
 * `fetchStaffFolios` (staff-folio.ts). A drift test keeps this list equal to the generated row type.
 */
export const CLINICAL_STAFF_COLUMNS_NO_FOLIO = [
  "active",
  "audited_task_count",
  "bio",
  "care_role",
  "created_at",
  "credential_type",
  "credential_verified_at",
  "credential_verified_by",
  "credentialing_level",
  "doctor_tier",
  "employment_type",
  "full_name",
  "id",
  "indemnity_exempt",
  "indemnity_exempt_by",
  "indemnity_expires_at",
  "indemnity_insurer",
  "indemnity_policy_number",
  "is_test",
  "languages",
  "license_expires_at",
  "license_verified_at",
  "max_concurrent_claims",
  "max_lead_patients",
  "offers_therapy_sessions",
  "organisation_id",
  "photo_url",
  "profile_id",
  "psv_grandfathered",
  "queue_last_seen_at",
  "red_flag_attested_at",
  "reliability_score",
  "signature_path",
  "signature_updated_at",
  "signature_updated_by",
  "specialist_type",
  "specialty",
  "staff_number",
  "status",
  "suspended_at",
  "suspended_reason",
  "updated_at",
  "verified_by",
  "years_of_experience",
] as const;

/** The same list as a PostgREST select string. */
export const CLINICAL_STAFF_SELECT_NO_FOLIO = CLINICAL_STAFF_COLUMNS_NO_FOLIO.join(", ");
