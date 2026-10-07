import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE, type UiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadAutomations } from "@/lib/automations/load";
import { asNotice, groupByHealth, OWNER_ROLES, type AutomationRow, type Health } from "@/lib/automations/model";
import { setAutomationOwnerAction } from "@/lib/automations/actions";

export const metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null);
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const TONE: Record<Health, string> = {
  failed: "bg-red-100 text-red-900",
  unowned: "bg-amber-100 text-amber-900",
  stale: "bg-amber-100 text-amber-900",
  ok: "bg-emerald-100 text-emerald-900",
  disabled: "bg-slate-100 text-slate-700",
};
const ORDER: Health[] = ["failed", "stale", "unowned", "ok", "disabled"];

/**
 * S80b: the operations screen for scheduled jobs (spec 25.8). Failed jobs first, then jobs that did not run when expected, then jobs with
 * no owner. It labels and assigns owners only; it never starts, stops or edits a job. Admins and operations users read it; setting an
 * owner needs an admin, checked in the database.
 */
export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const loaded = await loadAutomations();
  if (!loaded.ok && loaded.denied) redirect("/admin");
  const groups = loaded.ok ? groupByHealth(loaded.data) : null;
  const bad = notice === "failed" || notice === "denied";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("auto.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("auto.intro", locale)}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`auto.notice.${notice}`, locale)}
        </p>
      )}
      {!groups ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("auto.load_error", locale)}</p>
      ) : (
        ORDER.filter((h) => groups[h].length > 0).map((h) => <Section key={h} health={h} rows={groups[h]} locale={locale} />)
      )}
    </div>
  );
}

function Section({ health, rows, locale }: { health: Health; rows: AutomationRow[]; locale: UiLanguage }) {
  return (
    <section aria-labelledby={`h-${health}`} className="space-y-3">
      <h2 id={`h-${health}`} className="font-heading text-xl font-semibold text-charcoal-ink">
        {t(`auto.${health}`, locale)} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[health]}`}>{rows.length}</span>
      </h2>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-charcoal-ink">{r.name} <span className="ml-1 text-xs font-normal text-charcoal-ink/60">{r.schedule ?? ""}</span></p>
              <p className="text-xs text-charcoal-ink/70">
                {t("auto.last_run", locale)} {lagos(r.last_run_at) ?? t("auto.never", locale)}
                {r.owner_role ? ` · ${t("auto.owner", locale)}: ${r.owner_role}` : ""}
              </p>
            </div>
            {r.can_edit ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("auto.owner", locale)}</summary>
                <form action={setAutomationOwnerAction} className="mt-2 grid gap-2 sm:grid-cols-3">
                  <input type="hidden" name="id" value={r.id} />
                  <label className="block text-xs text-charcoal-ink">
                    {t("auto.owner_role", locale)}
                    <select name="owner_role" required defaultValue={r.owner_role ?? ""} className={field}>
                      <option value="" disabled></option>
                      {OWNER_ROLES.map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </label>
                  <label className="block text-xs text-charcoal-ink">
                    {t("auto.runbook", locale)}
                    <input name="runbook_url" type="url" defaultValue={r.runbook_url ?? ""} className={field} />
                  </label>
                  <label className="block text-xs text-charcoal-ink">
                    {t("auto.interval", locale)}
                    <input name="interval" type="number" min={1} className={field} />
                  </label>
                  <div><button type="submit" className={`${btn} bg-brand-green text-white`}>{t("auto.save", locale)}</button></div>
                </form>
              </details>
            ) : (
              <p className="text-xs text-charcoal-ink/60">{t("auto.no_edit", locale)}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
