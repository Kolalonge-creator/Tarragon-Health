import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyBroadcastLinkToken } from "@/lib/broadcasts/link-token";

// 1x1 transparent GIF, base64-embedded — never fetched from a third party,
// never regenerated per-request.
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64"
);

/**
 * Open-tracking pixel for broadcast emails. ALWAYS returns the 1x1 GIF
 * regardless of whether the signature checks out — a bad/missing/replayed
 * signature must never 404 or 500, since most email clients render the
 * <img> tag either way and a broken image is a visible defect in every
 * inbox, not just a security non-event. An invalid signature simply means
 * no event is recorded; it never becomes a visible failure.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const notificationId = url.searchParams.get("notification_id");
  const token = url.searchParams.get("token");

  if (notificationId && verifyBroadcastLinkToken(token, `open:${notificationId}`)) {
    // Best-effort — a failed insert must never affect the response the
    // recipient's mail client sees.
    try {
      const supabase = createServiceRoleClient();
      await supabase
        .from("broadcast_email_events")
        .insert({ notification_id: notificationId, event_type: "open" });
    } catch {
      // swallow — see comment above
    }
  }

  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
    },
  });
}
