import { createClient } from "@/lib/supabase/server";

/**
 * DSAR self-export, docs spec §87.8 — a patient downloads a machine-readable
 * copy of their own record. Same cookie-session auth pattern as the Health
 * Passport PDF route, and deliberately reuses the caller's own RLS-active
 * client (not a service-role bypass) for every query below: if a table has
 * no patient-visible SELECT policy, the query below returns empty rather
 * than needing this route to separately reason about which tables are safe
 * to include — RLS is already the source of truth for that.
 *
 * Logged via public.log_patient_data_export() (not private.log_care_access,
 * which deliberately skips a patient acting on their own record — see that
 * migration's comment) so the export itself shows up in the patient's own
 * care_access_events trail as a data_exported event.
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not signed in", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "patient") {
    return new Response("Not found", { status: 404 });
  }

  const [
    consents,
    vitals,
    medications,
    screeningResults,
    receipt,
    deletionRequests,
    correctionRequests,
    accessEvents,
    wearableConnections,
  ] = await Promise.all([
    supabase.from("patient_consents").select("*").eq("patient_id", user.id),
    supabase.from("vitals_readings").select("*").eq("patient_id", user.id),
    supabase.from("medications").select("*").eq("patient_id", user.id),
    supabase.from("screening_results").select("*").eq("patient_id", user.id),
    // Financial transactions aren't a single patient-scoped table (they're
    // linked via subscription_id, not patient_id) — reusing the existing
    // care_receipt() RPC's own computed summary rather than hand-rolling a
    // join here.
    supabase.rpc("care_receipt", { p_beneficiary: user.id }),
    supabase.from("data_deletion_requests").select("*").eq("patient_id", user.id),
    supabase.from("data_correction_requests").select("*").eq("patient_id", user.id),
    supabase.from("care_access_events").select("*").eq("patient_id", user.id),
    supabase.from("wearable_connections").select("*").eq("patient_id", user.id),
  ]);

  await supabase.rpc("log_patient_data_export", { p_scope: "data_export_dsar" });

  const exportPayload = {
    exported_at: new Date().toISOString(),
    exported_by: "self_service_dsar",
    profile,
    consents: consents.data ?? [],
    vitals_readings: vitals.data ?? [],
    medications: medications.data ?? [],
    screening_results: screeningResults.data ?? [],
    care_receipt_summary: receipt.data ?? null,
    data_deletion_requests: deletionRequests.data ?? [],
    data_correction_requests: correctionRequests.data ?? [],
    care_access_events: accessEvents.data ?? [],
    wearable_connections: wearableConnections.data ?? [],
  };

  return new Response(JSON.stringify(exportPayload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="tarragon-health-data-export.json"',
    },
  });
}
