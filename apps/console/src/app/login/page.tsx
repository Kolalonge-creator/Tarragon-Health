import { getCurrentUser } from "@tarragon/auth/supabase/server";
import { GuardLeafMark } from "@tarragon/ui/components/guard-leaf-mark";
import { t } from "@tarragon/i18n";
import { sanitizeRedirect } from "@tarragon/auth/redirect";
import { webAppUrl } from "@/lib/web-app-url";
import { signOut } from "@/app/actions";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function ConsoleLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectParam } = await searchParams;
  const redirectTo = sanitizeRedirect(redirectParam) ?? undefined;

  // proxy.ts only lets a signed-in person reach this page when they have NO
  // console access (a console role is redirected home first). Say so plainly
  // and offer sign-out, rather than showing a form that cannot help them.
  const user = await getCurrentUser();
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
          <h1 className="font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">
            {t("console.login.title")}
          </h1>
          <p className="mt-2 text-sm text-charcoal-ink/60">{t("console.login.subtitle")}</p>
        </div>

        <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
          {user ? (
            <div className="space-y-4 text-center">
              <p role="alert" className="text-sm text-charcoal-ink/80">
                {t("console.login.wrong_area")}
              </p>
              {webUrl ? (
                <a href={webUrl} className="text-sm font-medium text-brand-green hover:underline">
                  {webUrl.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
              <form action={signOut}>
                <button type="submit" className="text-sm font-medium text-brand-green hover:underline">
                  {t("console.signout")}
                </button>
              </form>
            </div>
          ) : (
            <LoginForm
              redirectTo={redirectTo}
              forgotUrl={webUrl ? `${webUrl}/forgot-password` : null}
              labels={{
                email: t("console.login.email"),
                password: t("console.login.password"),
                submit: t("console.login.submit"),
                submitting: t("console.login.submitting"),
                forgot: t("console.login.forgot"),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
