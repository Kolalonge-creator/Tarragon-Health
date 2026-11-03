import Link from "next/link";
import { LoginForm } from "./login-form";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";
import { getAuthLocale } from "@/lib/auth/auth-locale";
import { pickRedirectTarget } from "@/lib/auth/redirect";
import { passkeysAvailable } from "@/lib/passkeys/server";
import { safeJoinRedirect } from "@/lib/care-circle/join-link";
import { signupHrefFor } from "@/lib/auth/signup-href";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; next?: string; intent?: string }>;
}) {
  const { redirect, next, intent } = await searchParams;
  const locale = await getAuthLocale();
  const passkeysEnabled = await passkeysAvailable();
  // S69 (OQ-220): a join link opened while signed out must survive "Create an account" and the email-verification round trip, so the
  // sanitised destination rides along to /signup, which already threads it into emailRedirectTo.
  const safe = pickRedirectTarget({ redirect, next });
  // Someone sent here by a Care Circle link is joining as a supporter: "Create an account" must stay a supporter sign-up, or they are
  // walked through patient onboarding (goals, telehealth consent, date of birth and sex) for care they never asked for.
  const supporter = intent === "support" || safeJoinRedirect(safe) !== null;
  const signupHref = signupHrefFor(safe, supporter);

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-4 py-12 sm:py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <GuardLeafMark className="h-11 w-11" />
          <p className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">
            Tarragon<span className="text-brand-green">Health</span>
          </p>
          <p className="mt-1 text-sm text-charcoal-ink/60">Care that stays with you.</p>
        </div>

        <div className="text-center">
          <h1 className="font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-charcoal-ink/60">
            Sign in to pick up where you left off.
          </p>
        </div>

        <LoginForm redirectTo={safe ?? undefined} locale={locale} passkeysEnabled={passkeysEnabled} />

        <p className="text-center text-sm text-charcoal-ink/60">
          New here?{" "}
          <Link href={signupHref} className="font-medium text-brand-green hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
