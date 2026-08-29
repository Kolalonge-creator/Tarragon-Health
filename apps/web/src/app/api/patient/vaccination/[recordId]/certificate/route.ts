import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getVaccinationCertificateData } from "@/lib/vaccination/get-certificate-data";
import { VaccinationCertificateDocument } from "@/lib/vaccination/vaccination-certificate-document";

/**
 * Streams a patient's Tarragon vaccination certificate as a downloadable PDF.
 * Cookie-session auth (a browser link). Every read is RLS-scoped to the caller,
 * and getVaccinationCertificateData returns null unless the dose is actually
 * Tarragon-verified — so an unverified or someone else's record 404s.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ recordId: string }> },
): Promise<Response> {
  const { recordId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not signed in", { status: 401 });
  }

  const data = await getVaccinationCertificateData(supabase, recordId);
  if (!data) {
    return new Response("Not found", { status: 404 });
  }

  const buffer = await renderToBuffer(VaccinationCertificateDocument({ data }));

  // §1.24 export audit trail — best-effort, never blocks the download.
  await supabase.rpc("record_export_access", {
    p_patient_id: user.id,
    p_export_type: "vaccination_certificate",
    p_metadata: { record_id: recordId },
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tarragon-vaccination-${data.serial}.pdf"`,
    },
  });
}
