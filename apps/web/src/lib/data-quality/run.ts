import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface DataQualityScanResult {
  openFindingCount: number;
}

/**
 * Runs the §34.14 data quality engine (private.run_data_quality_scan(),
 * see the mdm_data_quality_engine migration) via its admin-gated public
 * RPC — the gate also allows the Postgres `service_role` connecting role
 * (same pattern as mdm_duplicate_detection_service_role_cron), so this
 * service-role call is not rejected the way a non-admin authenticated
 * caller would be.
 *
 * Purely a scan: it only opens/refreshes/auto-resolves
 * data_quality_findings rows for an admin to review, never mutates the
 * underlying clinical records it inspects.
 */
export async function runDataQualityScan(): Promise<DataQualityScanResult> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc("run_data_quality_scan");
  if (error) throw error;

  return { openFindingCount: data ?? 0 };
}
