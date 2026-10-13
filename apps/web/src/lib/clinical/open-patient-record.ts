/**
 * Opening a patient's record as staff (S39c, INV-10 and INV-12; founder direction 2026-10-07).
 *
 * A clinician may search for and open any patient in the organisation, with no reason to type and nothing shown to the patient. Every opening
 * is written to an append-only log by `public.open_patient_record`, and that same call grants the time window in which the tied tables become
 * readable for an untied clinician. So this call must run BEFORE the page reads the patient's clinical tables.
 *
 * A failure is never swallowed silently: the caller gets `failed` and the page decides what to show. A non-clinician (admin, coordinator) is
 * `not_applicable`: they have no opening to log and read through their own paths.
 */
interface RpcClient {
  rpc(fn: "open_patient_record", args: { p_patient: string }): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export type OpenRecordResult =
  | { status: "opened"; basis: "tied" | "open"; expiresAt: string }
  | { status: "not_applicable" }
  | { status: "failed"; message: string };

export async function openPatientRecord(supabase: unknown, patientId: string): Promise<OpenRecordResult> {
  const { data, error } = await (supabase as RpcClient).rpc("open_patient_record", { p_patient: patientId });
  if (error) {
    // 42501: not an active clinician. P0002: no such patient in this organisation. Neither is a logging failure.
    if (error.code === "42501" || error.code === "P0002") return { status: "not_applicable" };
    return { status: "failed", message: error.message };
  }
  const row = data as { opened?: unknown; basis?: unknown; expires_at?: unknown } | null;
  if (!row || row.opened !== true || (row.basis !== "tied" && row.basis !== "open") || typeof row.expires_at !== "string") {
    return { status: "failed", message: "unexpected response" };
  }
  return { status: "opened", basis: row.basis, expiresAt: row.expires_at };
}
