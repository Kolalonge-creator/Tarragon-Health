import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface PatientDuplicateDetectionResult {
  pendingCandidateCount: number;
}

/**
 * Runs the §34.4 duplicate-patient detector (private.detect_patient_
 * match_candidates(), see the mdm_duplicate_patient_detection migration)
 * via its admin-gated public RPC. The gate itself
 * (public.run_patient_duplicate_detection) additionally allows the Postgres
 * `service_role` connecting role — see mdm_duplicate_detection_service_
 * role_cron — so this service-role call is not rejected the way a
 * non-admin authenticated caller would be.
 *
 * Purely additive: it only inserts/updates PENDING candidate rows for a
 * human admin to review (never auto-merges — see the migration header),
 * so running it on a schedule carries no patient-facing risk.
 */
export async function runPatientDuplicateDetection(): Promise<PatientDuplicateDetectionResult> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc("run_patient_duplicate_detection");
  if (error) throw error;

  return { pendingCandidateCount: data ?? 0 };
}
