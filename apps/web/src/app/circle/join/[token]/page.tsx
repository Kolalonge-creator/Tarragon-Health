import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { isJoinToken, joinPath } from "@/lib/care-circle/join-link";
import { loadInviteLanding } from "@/lib/care-circle/invite-landing";
import { InviteLandingCard } from "./invite-landing-card";

export const metadata = { title: "Care Circle invite", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/**
 * Where a Care Circle link lands for someone who is not signed in (supporter join path). A relative abroad opening the link for the
 * first time sees who invited them and what they will be able to see, in their own voice, and gets one clear way in: a free
 * supporter account, or sign in. Nothing about the patient beyond their first name and the permission list is ever read here, and
 * only for a valid, pending, unexpired invite (public.care_circle_invite_landing, service role, rate-limited per address).
 *
 * Somebody already signed in goes straight to the real join page, which checks the invite against their account.
 */
export default async function CircleInviteLandingPage({ params }: { params: Promise<{ token: string }> }) {
  const token = safeDecode((await params).token);
  const user = await getCurrentUser();
  if (user && isJoinToken(token)) redirect(joinPath(token));
  const landing = await loadInviteLanding(token);
  return <InviteLandingCard token={token} landing={landing} locale="en" />;
}
