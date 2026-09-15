import { createClient } from "@/lib/supabase/server";
import { getFullPatientRecordExport } from "@/lib/data-export/get-full-patient-record";
import { hasFulfilledExportRequest } from "@/lib/data-export/require-fulfilled-export-request";

/**
 * Downloadable structured export of the caller's own complete patient
 * record (spec §34.17/§34.18: a patient must be able to obtain a
 * structured copy of their health information, and it must not become
 * trapped in the platform if they leave). Cookie-session auth, same
 * pattern as /api/patient/health-passport/pdf; every underlying query is
 * scoped to the caller's own patient_id and additionally protected by
 * RLS (patient reads own rows), so this can never return another
 * patient's data even if patientId were somehow altered.
 *
 * Gated behind an admin-fulfilled data_export_requests row (2026-09-07
 * patient UX fix pass) — see require-fulfilled-export-request.ts and the
 * sibling /api/patient/data-export/route.ts, which carries the full
 * rationale. No UI links to this route remain; the Health Passport page's
 * "Download your complete record" link was removed for the same reason.
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
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "patient") {
    return new Response("Not found", { status: 404 });
  }

  if (!(await hasFulfilledExportRequest(supabase, user.id))) {
    return new Response(
      "Request your data from Privacy & data first — an admin needs to review and approve it before it's available here.",
      { status: 403 }
    );
  }

  const record = await getFullPatientRecordExport(supabase, user.id);

  return new Response(JSON.stringify(record, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="tarragon-health-record.json"',
    },
  });
}
