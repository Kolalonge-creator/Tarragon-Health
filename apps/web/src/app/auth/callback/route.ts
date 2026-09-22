import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRoleHomePath } from "@/lib/auth/roles";
import { sanitizeRedirect } from "@/lib/auth/redirect";
import { stampActivity } from "@/lib/auth/idle-timeout";

/** Exchanges an email-confirmation / magic-link code for a session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectParam = searchParams.get("redirect");

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Backfill profiles.phone from signup metadata now that we have a session
  // (auth.users.phone is only auto-populated for phone-identity signups —
  // see the note in apps/web/src/app/signup/actions.ts).
  const metadataPhone = data.user.user_metadata?.phone;
  const metadataState = data.user.user_metadata?.state;
  const backfill: { phone?: string; state?: string; receives_care?: boolean } = {};
  if (typeof metadataPhone === "string" && metadataPhone.length > 0) {
    backfill.phone = metadataPhone;
  }
  // Optional state chosen at signup (non-gating) — pre-fills profiles.state.
  if (typeof metadataState === "string" && metadataState.length > 0) {
    backfill.state = metadataState;
  }
  // Someone who arrived to pay for a relative's care, not to be treated. Only
  // ever narrows what we ask of them; becoming a patient later re-imposes
  // every consent, enforced by enforce_care_purpose_switch.
  if (data.user.user_metadata?.account_purpose === "support") {
    backfill.receives_care = false;
  }
  if (Object.keys(backfill).length > 0) {
    await supabase.from("profiles").update(backfill).eq("id", data.user.id);
  }

  // Auto-redeem a referral code carried from a shareable ?ref=CODE signup
  // link, now that a session exists (redeem_referral_code reads auth.uid()).
  // redeem_referral_code enforces its own rules (self-referral, 30-day
  // window, one code per account) and returns { ok:false, error } rather
  // than throwing for those — either way this must never block the redirect
  // below, so failures are silently ignored here.
  const metadataRefCode = data.user.user_metadata?.ref_code;
  if (typeof metadataRefCode === "string" && metadataRefCode.length > 0) {
    await supabase.rpc("redeem_referral_code", { p_code: metadataRefCode });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  const home = profile ? getRoleHomePath(profile.role) : "/patient";
  const response = NextResponse.redirect(`${origin}${sanitizeRedirect(redirectParam) ?? home}`);

  // Fresh timestamp for THIS session — /auth/* is itself idle-timeout-exempt
  // (proxy.ts), so without this a user with a stale cookie from a previous
  // session who signs in via a magic link/email-confirmation link would be
  // redirected straight into a non-exempt page and immediately bounced to
  // /login?reason=idle right after a successful sign-in. See
  // stampActivityCookie's own doc comment (idle-timeout.ts) for the same fix
  // applied to every Server Action login path; this is the Route Handler
  // equivalent (stampActivity, not stampActivityCookie, since this
  // constructs its own NextResponse rather than running in a Server Action).
  stampActivity(response, Date.now());

  return response;
}
