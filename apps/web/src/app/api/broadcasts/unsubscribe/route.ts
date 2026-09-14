import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyBroadcastLinkToken } from "@/lib/broadcasts/link-token";

/**
 * One-click "unsubscribe from marketing emails" link, mailed inside every
 * patient-facing broadcast email (see supabase/functions/send-pending-
 * notifications's broadcast_announcement handler). Unauthenticated by
 * design — a patient clicking a link from their inbox has no session — so
 * the HMAC signature over "unsub:<profileId>" is what stands in for auth,
 * verified server-side the same way the wearables webhook route verifies
 * its provider signature before doing a trusted service-role write (see
 * apps/web/src/app/api/wearables/webhook/[provider]/route.ts).
 *
 * The only effect of a valid link is flipping profiles.marketing_opt_in to
 * false — never anything clinical/operational — so it's safe to offer on
 * every patient email regardless of whether that particular broadcast was
 * itself flagged as marketing.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profile_id");
  const token = url.searchParams.get("token");

  if (!profileId || !verifyBroadcastLinkToken(token, `unsub:${profileId}`)) {
    return htmlResponse(
      "This link is invalid or has expired.",
      "Please contact support if you keep getting marketing emails you don't want.",
      400
    );
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("profiles")
    .update({ marketing_opt_in: false })
    .eq("id", profileId);

  if (error) {
    return htmlResponse(
      "Something went wrong.",
      "We couldn't update your preferences just now. Please try the link again shortly.",
      500
    );
  }

  return htmlResponse(
    "You've been unsubscribed from marketing emails.",
    "You'll still receive appointment reminders and clinical notifications."
  );
}

function htmlResponse(heading: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tarragon Health</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #12324B; background: #F7F7F5; margin: 0; padding: 48px 20px; }
  .card { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  h1 { color: #0E7C52; font-size: 20px; margin: 0 0 12px; }
  p { line-height: 1.5; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(body)}</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
