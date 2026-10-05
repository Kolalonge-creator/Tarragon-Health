import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyBroadcastLinkToken } from "@/lib/broadcasts/link-token";

/**
 * Click-tracking redirect for the Trustpilot review-request email
 * (reputation_review_request_trustpilot). Reuses the exact HMAC
 * signing/verification the broadcast click-tracking links already use
 * (apps/web/src/lib/broadcasts/link-token.ts) under its own namespaced
 * message ("reputation-click:<promptId>") -- a prompt id being an
 * unguessable UUID is deliberately not treated as sufficient on its own,
 * matching /api/broadcasts/track-click's own header comment.
 *
 * There is no patient session at click time (this is a link opened from an
 * email), so this uses the service-role client -- a deliberate, narrow
 * exception to "never bypass RLS", scoped to a single write-once status
 * transition on a row already created server-side, identified by a value
 * nobody but this email's recipient has.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const promptId = url.searchParams.get("prompt_id");
  const token = url.searchParams.get("token");

  const reviewUrl = process.env.TRUSTPILOT_REVIEW_URL;
  if (!reviewUrl) {
    return errorPage();
  }
  if (!promptId || !verifyBroadcastLinkToken(token, `reputation-click:${promptId}`)) {
    return errorPage();
  }

  try {
    const supabase = createServiceRoleClient();
    await supabase
      .from("reputation_review_prompts")
      .update({ status: "clicked", clicked_at: new Date().toISOString() })
      .eq("id", promptId)
      .eq("channel", "trustpilot_email")
      .in("status", ["queued", "sent"]);
  } catch {
    // Never block the redirect on a failed analytics write -- the patient
    // still gets to Trustpilot either way.
  }

  return NextResponse.redirect(reviewUrl, { status: 302 });
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
