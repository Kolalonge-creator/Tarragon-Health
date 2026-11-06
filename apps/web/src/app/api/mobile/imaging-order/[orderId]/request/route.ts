import { createBearerClient } from "@/lib/supabase/bearer";
import { generateImagingRequestPdf } from "@/lib/imaging-orders/generate-imaging-request-pdf";

/**
 * Native counterpart to /api/patient/imaging-order/[orderId]/request (diagnostic directory Phase 5 on the phone). Same
 * generateImagingRequestPdf and the same RLS-scoped reads, reached with the patient's short-lived Supabase access token
 * instead of a cookie session. As with /api/mobile/lab-order/[orderId]/request, the token may come as an
 * `Authorization: Bearer` header or a `?token=` query param (the one case a header cannot be attached: opening the PDF in
 * expo-web-browser's in-app viewer). A foreign or unknown order is a 404 that does not reveal whether it exists.
 */
export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const { orderId } = await params;
  const headerToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const accessToken = headerToken ?? new URL(request.url).searchParams.get("token") ?? undefined;
  if (!accessToken) return new Response("Missing bearer token", { status: 401 });

  const supabase = createBearerClient(accessToken);
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) return new Response("Invalid or expired session", { status: 401 });

  const result = await generateImagingRequestPdf(supabase, orderId);
  if (!result.ok) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(result.buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${result.filename}"` },
  });
}
