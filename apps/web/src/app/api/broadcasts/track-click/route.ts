import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyBroadcastLinkToken } from "@/lib/broadcasts/link-token";

/**
 * Click-tracking redirect for a broadcast email's CTA button. The
 * destination URL is signed as PART OF the message ("click:<notificationId>:
 * <url>") — signing only the notification id would let anyone holding one
 * valid link reuse its signature to redirect to an arbitrary URL by just
 * swapping the `url` query param, since the signature would still "match".
 * Independently of the signature, the URL must also start with `https://`
 * before this will ever redirect — defense in depth beyond the signature
 * check, matching the brief's explicit requirement.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const notificationId = url.searchParams.get("notification_id");
  const token = url.searchParams.get("token");
  const target = url.searchParams.get("url");

  if (
    !notificationId ||
    !target ||
    !target.startsWith("https://") ||
    !verifyBroadcastLinkToken(token, `click:${notificationId}:${target}`)
  ) {
    return errorPage();
  }

  try {
    const supabase = createServiceRoleClient();
    await supabase.from("broadcast_email_events").insert({
      notification_id: notificationId,
      event_type: "click",
      url: target,
    });
  } catch {
    // Never block the redirect on a failed analytics write — the recipient
    // still gets where they were going.
  }

  return NextResponse.redirect(target, { status: 302 });
}

function errorPage(): NextResponse {
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
    <h1>This link is invalid or has expired.</h1>
    <p>Please contact support if you keep having trouble.</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
