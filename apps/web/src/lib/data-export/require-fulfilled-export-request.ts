import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Gates the self-export routes behind an admin-fulfilled data_export_requests
 * row — patient UX fix pass, 2026-09-07: the founder wants a patient to
 * request their data from admin rather than self-serve download it directly.
 * Removing the UI links alone doesn't stop a patient hitting these GET routes
 * directly on their own session cookie, so the actual access control lives
 * here: no fulfilled request for this patient, no export. Once an admin
 * reviews a request and flips it to 'fulfilled' (data_export_requests_update
 * policy, private.is_admin() only), the same patient session can retrieve
 * the file through the route that was already there — this is the
 * fulfilment mechanism, not just a UI gate.
 */
export async function hasFulfilledExportRequest(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<boolean> {
  const { count } = await supabase
    .from("data_export_requests")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("status", "fulfilled");
  return (count ?? 0) > 0;
}
