import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@tarragon/auth/supabase/server";
import { GuardLeafMark } from "@tarragon/ui/components/guard-leaf-mark";
import { sanitizeRedirect } from "@tarragon/auth/redirect";
import { t } from "@tarragon/i18n";
import { signOut } from "@/app/actions";
import { MfaChallengeForm } from "./mfa-challenge-form";

export const metadata = { title: "Enter your code" };

/**
 * Step-up challenge, reached only through proxy.ts's aal1-pending-aal2 gate.
 * A session with no enrolled factor is sent straight back to /login (which
 * lands console roles at their home via proxy.ts).
 */
export default async function ConsoleMfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectParam } = await searchParams;
  const redirectTo = sanitizeRedirect(redirectParam) ?? undefined;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const stepUpNeeded = aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel;
  if (!stepUpNeeded) redirect(redirectTo ?? "/login");

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
            {t("console.mfa.title")}
          </h1>
          <p className="mt-2 text-sm text-charcoal-ink/60">{t("console.mfa.body")}</p>
        </div>
        <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
          <MfaChallengeForm
            redirectTo={redirectTo}
            labels={{
              code: t("console.mfa.code_label"),
              verify: t("console.mfa.verify"),
              verifying: t("console.mfa.verifying"),
            }}
          />
        </div>
        <form action={signOut} className="text-center">
          <button type="submit" className="text-sm font-medium text-brand-green hover:underline">
            {t("console.signout_not_you")}
          </button>
        </form>
      </div>
    </div>
  );
}
