import { createBearerClient } from "@/lib/supabase/bearer";
import { loadSinglePrescription } from "@/lib/prescriptions/load-prescription-pdf-data";
import { isUuid } from "@/lib/prescriptions/ids";
import { prescriptionPdfResponse } from "@/lib/prescriptions/prescription-pdf-response";

/**
 * Native counterpart to /api/patient/prescriptions/[medicationId]/pdf: same document and issuing rules, reached
 * by a bearer-authenticated Expo client. The token is accepted as a header or as `?token=` (the in-app Safari
 * view cannot attach a header), exactly like /api/mobile/verified-documents/[id]/pdf. It is the same short-lived
 * Supabase access token, so every read is still RLS-scoped to that one session. `inline` so the patient sees it
 * at once with the system viewer's own Print and Share toolbar.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ medicationId: string }> },
): Promise<Response> {
  const { medicationId } = await params;
  if (!isUuid(medicationId)) return new Response("Not found", { status: 404 });

  const headerToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const accessToken = headerToken ?? new URL(request.url).searchParams.get("token") ?? undefined;
  if (!accessToken) return new Response("Missing bearer token", { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return new Response("Invalid or expired session", { status: 401 });

  const result = await loadSinglePrescription(supabase, user.id, medicationId, "mobile");
  return prescriptionPdfResponse(result, {
    disposition: "inline",
    filename: `prescription-${medicationId.slice(0, 8)}.pdf`,
  });
}
