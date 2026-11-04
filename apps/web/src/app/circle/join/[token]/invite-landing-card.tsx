import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";
import { Button } from "@/components/ui/button";
import { SupporterPermissionList } from "@/components/care-circle/supporter-permission-list";
import { joinPath, type InviteLanding } from "@/lib/care-circle/join-link";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/** The supporter sign-up and sign-in links, each carrying the join link so the person lands back on it to accept. */
export function supporterAuthLinks(token: string): { signup: string; login: string } {
  const back = encodeURIComponent(joinPath(token));
  return { signup: `/signup?intent=support&redirect=${back}`, login: `/login?intent=support&redirect=${back}` };
}

/**
 * The signed-out Care Circle landing. Calm, one screen, two ways in. Every failure (unknown, used, cancelled, expired, a malformed
 * link) shows the same kind message, so the page never says which of those it was; only the rate limit is named, because that one
 * is about the visitor's connection, not the invite.
 */
export function InviteLandingCard({ token, landing, locale }: { token: string; landing: InviteLanding; locale: Locale }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-white px-4 py-12 sm:py-16 dark:bg-night-ground">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <GuardLeafMark className="h-11 w-11" />
          <p className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">
            Tarragon<span className="text-brand-green">Health</span>
          </p>
          <p className={`mt-1 text-sm ${MUTED}`}>Care that stays with you.</p>
        </div>

        {landing.ok ? (
          <Valid token={token} landing={landing} locale={locale} />
        ) : (
          <div className="space-y-3 rounded-2xl border border-charcoal-ink/10 bg-white p-6 text-center shadow-sm dark:border-night-ink/15 dark:bg-night-card">
            <h1 className="font-heading text-xl font-semibold text-charcoal-ink dark:text-night-ink">
              {t("supporterjoin.landing.invalid_title", locale)}
            </h1>
            <p role="alert" className={`text-sm ${MUTED}`}>
              {"rate_limited" in landing ? t("supporterjoin.landing.busy", locale) : t("supporterjoin.landing.invalid", locale)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Valid({ token, landing, locale }: { token: string; landing: Extract<InviteLanding, { ok: true }>; locale: Locale }) {
  const name = landing.inviter_first_name;
  const links = supporterAuthLinks(token);
  return (
    <div className="space-y-6 rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7 dark:border-night-ink/15 dark:bg-night-card">
      <div className="space-y-2 text-center">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl dark:text-night-ink">
          {t("supporterjoin.landing.title", locale, { name })}
        </h1>
        <p className={`text-sm ${MUTED}`}>{t("supporterjoin.landing.lead", locale, { name })}</p>
      </div>

      <div className="rounded-xl bg-soft-sage/50 p-4 dark:bg-brand-green/10">
        <SupporterPermissionList permissions={landing.permissions} name={name} locale={locale} />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-charcoal-ink dark:text-night-ink">{t("supporterjoin.landing.free", locale)}</p>
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {t(landing.contact_kind === "email" ? "supporterjoin.landing.contact_email" : "supporterjoin.landing.contact_phone", locale, {
            hint: landing.contact_hint,
          })}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button asChild className="min-h-11 w-full">
          <Link href={links.signup}>{t("supporterjoin.landing.create", locale)}</Link>
        </Button>
        <Button asChild variant="outline" className="min-h-11 w-full">
          <Link href={links.login}>{t("supporterjoin.landing.sign_in", locale)}</Link>
        </Button>
        <p className={`text-center text-xs ${MUTED}`}>{t("supporterjoin.landing.after", locale)}</p>
      </div>
    </div>
  );
}
