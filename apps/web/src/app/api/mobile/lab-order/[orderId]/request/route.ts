import { createBearerClient } from "@/lib/supabase/bearer";
import { generateLabRequestPdf } from "@/lib/lab-results/generate-lab-request-pdf";

/**
 * Native counterpart to /api/patient/lab-order/[orderId]/request — same
 * generateLabRequestPdf, same RLS-scoped authority, just reached by a
 * bearer-authenticated Expo client instead of a cookie session (see
 * lib/supabase/bearer.ts).
 *
 * The token is accepted two ways: the `Authorization: Bearer` header for a
 * plain authenticated fetch, or a `?token=` query param for the one case a
 * header can't be attached — opening this URL in expo-web-browser's
 * in-app Safari view (so the patient gets Safari's native PDF viewer, with
 * its own Print/Share/Save-to-Files toolbar, for free). The query-param
 * token is exactly the same short-lived Supabase access token the header
 * form would carry — never a separate, longer-lived credential — and every
 * read it unlocks is still RLS-scoped to that one session, same as the
 * header path.
 *
 * `inline` rather than the web route's `attachment`: a mobile patient wants
 * to see the request immediately in Safari's viewer, not have it silently
 * land in Files.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const { orderId } = await params;

  const authHeader = request.headers.get("authorization");
  const headerToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  const queryToken = new URL(request.url).searchParams.get("token") ?? undefined;
  const accessToken = headerToken ?? queryToken;
  if (!accessToken) {
    return new Response("Missing bearer token", { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return new Response("Invalid or expired session", { status: 401 });
  }

  const result = await generateLabRequestPdf(supabase, orderId);
  if (!result.ok) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${result.filename}"`,
    },
  });
}
