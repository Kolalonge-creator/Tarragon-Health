import { createBearerClient } from "@/lib/supabase/bearer";
import { loadPrescriptionBundle } from "@/lib/prescriptions/load-prescription-pdf-data";
import { prescriptionPdfResponse } from "@/lib/prescriptions/prescription-pdf-response";

/** Native counterpart to /api/patient/prescriptions/pdf: every current prescription, one page each. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headerToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const accessToken = headerToken ?? url.searchParams.get("token") ?? undefined;
  if (!accessToken) return new Response("Missing bearer token", { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return new Response("Invalid or expired session", { status: 401 });

  const requested = url.searchParams.get("patientId");
  if (requested && !/^[0-9a-f-]{36}$/i.test(requested)) return new Response("Not found", { status: 404 });

  const result = await loadPrescriptionBundle(supabase, user.id, requested ?? user.id, "mobile");
  return prescriptionPdfResponse(result, { disposition: "inline", filename: "prescriptions.pdf" });
}
