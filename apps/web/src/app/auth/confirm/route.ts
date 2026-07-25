import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirect } from "@/lib/auth/redirect";

/**
 * Verifies a `token_hash`-based email link (password recovery, email change).
 * Separate from /auth/callback: that route exchanges a PKCE `?code=` (magic
 * link / signup confirmation); Supabase's hosted recovery link instead
 * delivers the session via a URL fragment the server can never see, which
 * silently dropped the session and bounced to /login. This route reads the
 * token server-side via verifyOtp — no fragment, no PKCE code-verifier, so it
 * also works when the email is opened on a different device than the request.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = sanitizeRedirect(searchParams.get("next")) ?? "/login";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/forgot-password?error=invalid_or_expired_link`);
}
