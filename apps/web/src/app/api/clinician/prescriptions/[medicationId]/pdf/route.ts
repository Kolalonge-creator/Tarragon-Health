import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/prescriptions/ids";
import { loadPrescriptionForClinician } from "@/lib/prescriptions/load-prescription-pdf-data";
import { prescriptionPdfResponse } from "@/lib/prescriptions/prescription-pdf-response";

/**
 * A clinician reprints a patient's prescription from the chart. `?patientId=` is required because staff do not read
 * `medications` directly: the audited, tie-gated read decides, so a clinician who is not on this patient's care team
 * gets "not found". A care coordinator is refused outright (logistics only, never a clinical document).
 */
export async function GET(request: Request, { params }: { params: Promise<{ medicationId: string }> }): Promise<Response> {
  const { medicationId } = await params;
  const patientId = new URL(request.url).searchParams.get("patientId");
  if (!isUuid(medicationId) || !isUuid(patientId)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: self } = await supabase
    .from("clinical_staff_directory")
    .select("doctor_tier, active")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!self || self.active !== true || !self.doctor_tier || self.doctor_tier === "care_coordinator") {
    return new Response("Not found", { status: 404 });
  }

  const result = await loadPrescriptionForClinician(supabase, user.id, patientId, medicationId);
  return prescriptionPdfResponse(result, {
    disposition: "attachment",
    filename: `prescription-${medicationId.slice(0, 8)}.pdf`,
  });
}
