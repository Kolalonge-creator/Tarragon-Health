import { createClient } from "@/lib/supabase/server";
import { renderReferralLetter } from "@/lib/referrals/render-referral-letter";

/**
 * The take-anywhere specialist referral letter (cookie session). The render, and its RLS-scoped reads, live in
 * renderReferralLetter so the native app's bearer route returns the identical letter.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ referralId: string }> },
): Promise<Response> {
  const { referralId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  return renderReferralLetter(supabase, referralId);
}
