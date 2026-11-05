import { redirect } from "next/navigation";
import { getCurrentUser } from "@tarragon/auth/supabase/server";
import { GuardLeafMark } from "@tarragon/ui/components/guard-leaf-mark";
import { t } from "@tarragon/i18n";
import { signOut } from "@/app/actions";
import { webAppUrl } from "@/lib/web-app-url";

export const metadata = { title: "Turn on two-factor sign-in" };

/**
 * Reached only through proxy.ts when a console account is in a group whose two-factor sign-in requirement is on (admin switch
 * at /admin/settings/two-factor on the main app) and it has no verified authenticator factor.
 * The factor is set up on the main app's /account page (the same Supabase user; console sessions are host-only, so the person
 * signs in there, sets it up, then signs in here again and completes the challenge).
 */
export default async function ConsoleMfaSetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const webUrl = webAppUrl();

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
          <h1 className="font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">{t("console.mfa_setup.title")}</h1>
          <p className="mt-2 text-sm text-charcoal-ink/60">{t("console.mfa_setup.body")}</p>
        </div>
        <div className="space-y-4 rounded-2xl border border-charcoal-ink/10 bg-white p-6 text-center shadow-sm sm:p-7">
          {webUrl ? (
            <a href={`${webUrl}/account`} className="text-sm font-medium text-brand-green hover:underline">
              {t("console.mfa_setup.link")}
            </a>
          ) : (
            <p className="text-sm text-charcoal-ink/80">{t("console.mfa_setup.no_link")}</p>
          )}
          <form action={signOut}>
            <button type="submit" className="text-sm font-medium text-brand-green hover:underline">
              {t("console.signout")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
