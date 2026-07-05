import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRoleHomePath } from "@/lib/auth/roles";
import { sanitizeRedirect } from "@/lib/auth/redirect";

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
  if (typeof metadataPhone === "string" && metadataPhone.length > 0) {
    await supabase.from("profiles").update({ phone: metadataPhone }).eq("id", data.user.id);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  const home = profile ? getRoleHomePath(profile.role) : "/patient";
  return NextResponse.redirect(`${origin}${sanitizeRedirect(redirectParam) ?? home}`);
}
