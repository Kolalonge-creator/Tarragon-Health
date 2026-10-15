import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { loadAdherenceReport } from "@/lib/medicines/adherence-report-data";
import { AdherenceReportDocument } from "@/lib/medicines/adherence-report-document";

/**
 * The patient's own adherence report as a PDF (S08x, decision C6), free for every patient. Cookie-session auth,
 * and every read runs under the caller's own session so row level security keeps it to her own medicines.
 * A failed read answers 503 with no document: a PDF built from a read that failed would say "nothing was due".
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).single();
  if (!profile || profile.role !== "patient") return new Response("Not found", { status: 404 });

  const report = await loadAdherenceReport(supabase, user.id);
  if (!report.ok) return new Response("The report could not be built just now. Please try again.", { status: 503 });

  const buffer = await renderToBuffer(AdherenceReportDocument({ patientName: profile.full_name ?? "the patient", data: report.data }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="doses-marked-taken.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}
