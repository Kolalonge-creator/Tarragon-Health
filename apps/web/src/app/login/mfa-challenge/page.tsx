import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { resolveLoginDestination } from "@/lib/auth/redirect-after-login";
import { signOut } from "@/app/auth/actions";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";
import { MfaChallengeForm } from "./mfa-challenge-form";

/**
 * Step-up challenge for an account that has turned on two-factor
 * authentication — reached only via proxy.ts's aal1-pending-aal2 gate
 * (never linked to directly). A session that hasn't enrolled a factor never
 * lands here at all, so this page changes nothing for anyone who hasn't
 * opted in.
 */
export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectTo } = await searchParams;

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const stepUpNeeded = aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel;

  if (!stepUpNeeded) {
    redirect(await resolveLoginDestination(supabase, user.id, redirectTo));
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-4 py-12 sm:py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <GuardLeafMark className="h-11 w-11" />
          <p className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">
            Tarragon<span className="text-brand-green">Health</span>
          </p>
        </div>

        <div className="text-center">
          <h1 className="font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">
            Enter your code
          </h1>
          <p className="mt-2 text-sm text-charcoal-ink/60">
            Open your authenticator app and enter the 6-digit code for TarragonHealth.
          </p>
        </div>

        <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
          <MfaChallengeForm redirectTo={redirectTo} />
        </div>

        <form action={signOut} className="text-center">
          <button type="submit" className="text-sm font-medium text-brand-green hover:underline">
            Not you? Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
