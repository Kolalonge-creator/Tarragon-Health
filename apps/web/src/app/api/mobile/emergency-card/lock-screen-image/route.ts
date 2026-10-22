import { createBearerClient } from "@/lib/supabase/bearer";
import { lockScreenImageResponse, lockScreenOptionsFromUrl } from "@/lib/emergency/lock-screen-image-response";

/**
 * Native counterpart to /api/patient/emergency-card/lock-screen-image: the same picture, reached by the Expo app with the caller's bearer token.
 * The token is accepted as an `Authorization: Bearer` header, or as `?token=` for the one case a header cannot be attached (opening the URL in the
 * in-app browser, where the person can press and hold the picture to save it). It is the same short-lived Supabase access token, never a separate
 * credential, and every read is RLS-scoped to that session (the same pattern as /api/mobile/verified-documents/[id]/pdf).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== "1") return new Response("Please confirm first", { status: 400 });

  const headerToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const accessToken = headerToken ?? url.searchParams.get("token") ?? undefined;
  if (!accessToken) return new Response("Missing bearer token", { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) return new Response("Invalid or expired session", { status: 401 });

  return lockScreenImageResponse({ supabase, userId: user.id, options: lockScreenOptionsFromUrl(url), disposition: "inline" });
}
