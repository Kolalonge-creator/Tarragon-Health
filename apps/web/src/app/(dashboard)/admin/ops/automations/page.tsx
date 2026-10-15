import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadAutomations } from "@/lib/automations/load";
import { asNotice, pauseState, type AutomationRow } from "@/lib/automations/model";
import { setAutomationPausedAction } from "@/lib/automations/actions";

export const metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/**
 * S80 (25.8): every scheduled job, who owns it, when it last ran, and a guarded pause. Owners and purposes show as not recorded
 * until a person records them. A safety-critical job and a Vercel cron have no pause control; the database refuses them anyway.
 */
export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const loaded = await loadAutomations();
  if (!loaded.ok && loaded.denied) redirect("/admin");
  const bad = notice !== null && notice !== "paused" && notice !== "resumed";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("automations.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("automations.intro", locale)}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`automations.notice.${notice}`, locale)}
        </p>
      )}
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("automations.load_error", locale)}</p>
      ) : (
        <ul className="grid gap-2">
          {loaded.data.map((r) => (
            <Row key={r.job_name} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ r }: { r: AutomationRow }) {
  const locale = DEFAULT_UI_LANGUAGE;
  const state = pauseState(r);
  return (
    <li className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-charcoal-ink">
          {r.job_name}
          {r.is_paused && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{t("automations.paused", locale)}</span>}
          {r.safety_critical && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">{t("automations.safety", locale)}</span>}
          {!r.registered && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">{t("automations.unregistered", locale)}</span>}
        </p>
        <p className="text-xs text-charcoal-ink/70">
          {t("automations.owner", locale)}: {r.owner === "unassigned" ? t("automations.owner_none", locale) : r.owner} · {r.source === "vercel" ? "Vercel" : "pg_cron"} · {r.schedule ?? "-"}
        </p>
      </div>
      <p className="text-xs text-charcoal-ink/70">
        {r.purpose ?? t("automations.purpose_none", locale)} · {t("automations.last_run", locale)} {when(r.last_run_at)}
        {r.last_status ? ` (${r.last_status})` : ""}
        {r.is_paused && r.reason ? ` · ${r.reason}` : ""}
      </p>
      {state === "paused" || state === "can_pause" ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-brand-green">{state === "paused" ? t("automations.resume", locale) : t("automations.pause", locale)}</summary>
          <form action={setAutomationPausedAction} className="mt-2 space-y-2">
            <input type="hidden" name="job_name" value={r.job_name} />
            <input type="hidden" name="paused" value={state === "paused" ? "false" : "true"} />
            {state === "can_pause" && (
              <label className="block text-xs text-charcoal-ink">
                {t("automations.reason", locale)}
                <input name="reason" required minLength={10} maxLength={300} className={field} />
              </label>
            )}
            <button type="submit" className={`${btn} bg-brand-green text-white`}>{state === "paused" ? t("automations.resume", locale) : t("automations.pause", locale)}</button>
          </form>
        </details>
      ) : (
        <p className="text-xs text-charcoal-ink/60">{t(`automations.no_pause.${state}`, locale)}</p>
      )}
    </li>
  );
}
