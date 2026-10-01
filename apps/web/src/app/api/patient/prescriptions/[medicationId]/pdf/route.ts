import { createClient } from "@/lib/supabase/server";
import { loadSinglePrescription } from "@/lib/prescriptions/load-prescription-pdf-data";
import { prescriptionPdfResponse } from "@/lib/prescriptions/prescription-pdf-response";

/**
 * One prescription as a PDF the patient (or a caregiver the medications policy admits) can take to a pharmacy.
 * Cookie session, RLS-scoped to the caller. The issuing rules live in lib/prescriptions/prescription-pdf-data.ts.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ medicationId: string }> },
): Promise<Response> {
  const { medicationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(medicationId)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const result = await loadSinglePrescription(supabase, user.id, medicationId, "web");
  return prescriptionPdfResponse(result, {
    disposition: "attachment",
    filename: `prescription-${medicationId.slice(0, 8)}.pdf`,
  });
}
