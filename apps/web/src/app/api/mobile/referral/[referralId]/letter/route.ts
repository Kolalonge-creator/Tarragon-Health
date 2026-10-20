import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { renderReferralLetter } from "@/lib/referrals/render-referral-letter";

/**
 * Native counterpart to /api/patient/referral/[referralId]/letter: the same letter, reached by a bearer-authenticated Expo client.
 * The token is accepted as an `Authorization: Bearer` header or, for the one case a header cannot be attached (expo-web-browser's
 * in-app Safari view, which gives the patient Safari's own Print/Share/Save toolbar), as `?token=` — the same short-lived Supabase
 * access token either way, never a separate credential. Every read is still RLS-scoped to that one session. Mirrors
 * /api/mobile/verified-documents/[id]/pdf.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ referralId: string }> },
): Promise<Response> {
  const { referralId } = await params;
  if (!z.string().uuid().safeParse(referralId).success) return new Response("Not found", { status: 404 });

  const headerToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const accessToken = headerToken ?? new URL(request.url).searchParams.get("token") ?? undefined;
  if (!accessToken) return new Response("Missing bearer token", { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) return new Response("Invalid or expired session", { status: 401 });

  return renderReferralLetter(supabase, referralId, "inline");
}
