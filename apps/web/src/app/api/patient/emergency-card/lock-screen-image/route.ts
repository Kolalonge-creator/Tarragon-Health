import { createClient } from "@/lib/supabase/server";
import { lockScreenImageResponse, lockScreenOptionsFromUrl } from "@/lib/emergency/lock-screen-image-response";

/**
 * The caller's OWN emergency card as a portrait picture for a phone's lock screen (LSI-1). Needs `?confirm=1`, which only the screen that shows
 * the shared-phone warning and an explicit tick ever links to; `&qr=0` leaves the QR off and `&minimum=0` widens the picture from the usual minimum
 * to everything the person chose on the card chooser (never beyond it).
 *
 * The person's own lock-screen switch must be on (off by default). The work, including the audit row, happens in lockScreenImageResponse.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== "1") return new Response("Please confirm first", { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  return lockScreenImageResponse({ supabase, userId: user.id, options: lockScreenOptionsFromUrl(url) });
}
