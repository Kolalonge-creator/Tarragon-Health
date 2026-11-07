import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { isJoinToken, joinPath } from "@/lib/care-circle/join-link";
import { JoinCard } from "./join-card";

export const metadata = { title: "Join a Care Circle", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/**
 * The invite link a patient shares. The token is in the path so it survives sign-up, email confirmation and onboarding; the page asks
 * the database whether THIS signed-in account may accept it. A signed-out visitor never reaches here: the proxy sends them to the
 * landing at /circle/join/<token>.
 */
/** A malformed escape is the same "this link does not work" as any other bad link, never a server error. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const token = safeDecode((await params).token);
  // Someone who has just made an account to accept this invite has not finished onboarding yet. The shared dashboard gate would send
  // them to /onboarding and drop the link, so send them there ourselves with the link attached; onboarding returns them here.
  const profile = await getCurrentProfile();
  if (profile && profile.role === "patient" && !profile.onboarding_completed_at && isJoinToken(token)) {
    redirect(`/onboarding?redirect=${encodeURIComponent(joinPath(token))}`);
  }
  const { uiLanguage } = await getPatientDashboardContext({ area: "supporter" });
  return (
    <div className="mx-auto w-full max-w-lg py-2">
      <JoinCard token={token} locale={uiLanguage} />
    </div>
  );
}
