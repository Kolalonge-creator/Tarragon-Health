import { createClient } from "@/lib/supabase/server";
import { fetchMyExport } from "@/lib/data-export/fetch-my-export";

/**
 * DSAR self-export, docs spec §87.8 — a patient downloads a machine-readable
 * copy of their own record. S39f (OQ-285): the body is now the COMPLETE export built from the
 * patient-table registry (every registered table, credentials removed) by public.export_my_data(),
 * which itself refuses unless an admin has fulfilled a request within the review period. The
 * paragraphs below describe the earlier fixed list of about 16 tables. Same cookie-session auth pattern as the Health
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
 *
 * Gated behind an admin-fulfilled data_export_requests row (2026-09-07
 * patient UX fix pass) — the founder wants a patient to request their data
 * from admin rather than self-serve download it directly. This route no
 * longer has a UI link at all; it now only serves the file once an admin has
 * reviewed and fulfilled a request, see require-fulfilled-export-request.ts.
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not signed in", { status: 401 });
  }

  const result = await fetchMyExport(supabase);
  if (result.status === "not_approved") {
    return new Response(
      "Request your data from Privacy & data first — an admin needs to review and approve it before it's available here.",
      { status: 403 }
    );
  }
  if (result.status === "failed") {
    console.error("Patient data export failed", result.message);
    return new Response("We could not prepare your export. Please try again.", { status: 500 });
  }

  await supabase.rpc("log_patient_data_export", { p_scope: "data_export_dsar" });

  return new Response(JSON.stringify({ exported_by: "self_service_dsar", ...result.payload }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="tarragon-health-data-export.json"',
    },
  });
}
