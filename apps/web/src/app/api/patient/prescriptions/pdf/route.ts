import { createClient } from "@/lib/supabase/server";
import { loadPrescriptionBundle } from "@/lib/prescriptions/load-prescription-pdf-data";
import { prescriptionPdfResponse } from "@/lib/prescriptions/prescription-pdf-response";

/**
 * Every current prescription for one patient, one page each. `?patientId=` lets a caregiver fetch the person
 * they care for; omitted, it is the signed-in patient. RLS still decides what is readable.
 */
export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const requested = new URL(request.url).searchParams.get("patientId");
  if (requested && !/^[0-9a-f-]{36}$/i.test(requested)) return new Response("Not found", { status: 404 });

  const result = await loadPrescriptionBundle(supabase, user.id, requested ?? user.id, "web");
  return prescriptionPdfResponse(result, { disposition: "attachment", filename: "prescriptions.pdf" });
}
