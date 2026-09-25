import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRoleHomePath } from "@/lib/auth/roles";
import { sanitizeRedirect } from "@/lib/auth/redirect";
import { backfillSignupMetadata } from "@/lib/auth/backfill-signup-metadata";

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

  // Backfill phone/state/account_purpose and redeem a carried referral code
  // now that a session exists — shared with signup/actions.ts's own redirect
  // for when email confirmations are disabled and a session comes back
  // directly from signUp(), never reaching this route at all.
  await backfillSignupMetadata(supabase, data.user);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  const home = profile ? getRoleHomePath(profile.role) : "/patient";
  return NextResponse.redirect(`${origin}${sanitizeRedirect(redirectParam) ?? home}`);
}
