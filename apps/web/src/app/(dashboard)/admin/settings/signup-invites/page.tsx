import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadInviteOnly, loadInvites } from "@/lib/signup-invites/load";
import { asNotice } from "@/lib/signup-invites/model";
import { revokeInviteAction, setInviteOnlyAction } from "@/lib/signup-invites/actions";
import { InviteCreateForm } from "./invite-create-form";

export const metadata = { title: "Sign-up invites" };
export const dynamic = "force-dynamic";

const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

/**
 * The pilot sign-up invite list (admin only). Sign-up stays open to everyone until an admin switches invite-only on here; people who already
 * have an account are never affected. The database enforces the rule; this screen manages who is on the list and the switch.
 */
export default async function SignupInvitesPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const notice = asNotice((await searchParams).n);
  const [loaded, inviteOnly] = await Promise.all([loadInvites(), loadInviteOnly()]);
  if (!loaded.ok && loaded.denied) redirect("/admin");
  const bad = notice === "failed" || notice === "denied";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("signupinv.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("signupinv.intro")}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {notice === "revoked" ? t("signupinv.notice.revoked") : notice === "switched" ? "Saved." : notice === "denied" ? t("signupinv.notice.denied") : t("signupinv.notice.failed")}
        </p>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-ink/10 bg-white p-3 dark:border-night-ink/15 dark:bg-night-card">
        <p className="text-sm font-medium text-charcoal-ink">{inviteOnly === null ? "The sign-up setting could not be read." : inviteOnly ? t("signupinv.status_on") : t("signupinv.status_off")}</p>
        {inviteOnly !== null && (
          <form action={setInviteOnlyAction}>
            <input type="hidden" name="on" value={inviteOnly ? "false" : "true"} />
            <button type="submit" className={`${btn} ${inviteOnly ? "border border-charcoal-ink/20 text-charcoal-ink" : "bg-brand-green text-white"}`}>
              {inviteOnly ? "Open sign-up to everyone" : "Switch on invite-only sign-up"}
            </button>
          </form>
        )}
      </section>

      <InviteCreateForm />

      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("signupinv.load_error")}</p>
      ) : loaded.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("signupinv.empty")}</p>
      ) : (
        <ul className="grid gap-2">
          {loaded.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <div className="min-w-0">
                <p className="font-medium text-charcoal-ink">{r.identifier} <span className="ml-1 text-xs font-normal text-charcoal-ink/60">{t(`signupinv.kind.${r.kind}`)}</span></p>
                <p className="text-xs text-charcoal-ink/70">
                  {r.label} · {t(`signupinv.status.${r.status}`)} · {r.uses}/{r.max_uses} · until {day(r.expires_at)}
                </p>
              </div>
              {r.status === "open" && (
                <form action={revokeInviteAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("signupinv.revoke")}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
