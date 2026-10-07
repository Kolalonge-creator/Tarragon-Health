import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getFullPatientRecordExport } from "@/lib/data-export/get-full-patient-record";
import { hasFulfilledExportRequest } from "@/lib/data-export/require-fulfilled-export-request";
import { DataExportDocument } from "@/lib/data-export/data-export-document";

/**
 * The PDF copy of a patient's own record (v5 1.15). Same gate as the JSON copies: an admin-reviewed, fulfilled
 * data_export_requests row must exist (founder 2026-09-07, OQ-50). Cookie-session auth; every read runs on the caller's own
 * RLS-scoped client and is scoped to their own id, so it can never include anyone else's data. Rendered on download from the
 * live record: nothing is stored, so a research withdrawal or a correction made since the request is already reflected.
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "patient") return new Response("Not found", { status: 404 });

  if (!(await hasFulfilledExportRequest(supabase, user.id))) {
    return new Response("Request your data from Privacy & data first. An admin needs to review and approve it before it is available here.", { status: 403 });
  }

  const record = await getFullPatientRecordExport(supabase, user.id);
  const { data: consents } = await supabase
    .from("consent_matrix_events")
    .select("data_type, purpose, action, created_at")
    .eq("patient_id", user.id)
    .order("created_at", { ascending: false });

  await supabase.rpc("log_patient_data_export", { p_scope: "data_export_dsar" });

  const buffer = await renderToBuffer(DataExportDocument({ record, consents: consents ?? [] }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="tarragon-health-record.pdf"',
    },
  });
}
