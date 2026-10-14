import { t } from "@tarragon/i18n";
import type { UiLanguage } from "@tarragon/shared";
import { deadlines, INCIDENT_SEVERITIES, labelKey, type DeadlineState, type InboxRow } from "@/lib/concerns/model";
import { acknowledgeConcernAction, closeConcernAction, openIncidentAction, respondToConcernAction } from "@/lib/concerns/actions";

/**
 * One concern in the readers' inbox, shared by the lead's page and the readers' page so the two can never drift. Which of the two fixed
 * pages an action returns to is chosen by the hidden `return` field (`lead` or `reader`), never by an address. A concern is never in a link.
 */
type Locale = UiLanguage;
export const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
export const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
export const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const DEADLINE_STYLE: Record<DeadlineState, string> = { overdue: "bg-red-100 text-red-900", open: "bg-sky-100 text-sky-900", done: "bg-emerald-100 text-emerald-900" };

export const Alert = ({ children }: { children: React.ReactNode }) => (
  <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{children}</p>
);

function Deadline({ label, state, due, hours, locale }: { label: string; state: DeadlineState; due: string; hours: number | null; locale: Locale }) {
  return (
    <p className="text-xs text-charcoal-ink/70">
      {label} {lagos(due)}{" "}
      <span className={`ml-1 rounded-full px-2 py-0.5 font-semibold ${DEADLINE_STYLE[state]}`}>
        {state === "done" ? t("speakup.deadline.done", locale) : state === "overdue" ? `${t("speakup.deadline.overdue", locale)}${hours !== null ? `, ${t("speakup.deadline.hours_over", locale, { hours: Math.abs(hours) })}` : ""}` : hours !== null ? t("speakup.deadline.hours_left", locale, { hours }) : ""}
      </span>
    </p>
  );
}

export function ConcernCard({ c, now, locale, returnTo }: { c: InboxRow; now: number; locale: Locale; returnTo: "lead" | "reader" }) {
  const d = deadlines(c, now);
  const late = d.acknowledge === "overdue" || d.respond === "overdue";
  const back = <input type="hidden" name="return" value={returnTo} />;
  return (
    <li className={`rounded-xl border bg-white text-sm dark:bg-night-card ${late ? "border-red-300" : "border-charcoal-ink/10 dark:border-night-ink/15"}`}>
      <details open={c.state !== "closed"}>
        <summary className="cursor-pointer space-y-1 p-4">
          <span className="font-medium text-charcoal-ink">
            {t(labelKey("concern.category", c.category), locale)} · {t(labelKey("concern.severity", c.severity), locale)}
            <span className="ml-2 rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs font-semibold">{t(`speakup.state.${c.state}`, locale)}</span>
            {c.anonymous && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900">{t("speakup.badge.anonymous", locale)}</span>}
            {c.routing === "independent_only" && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">{t("speakup.badge.independent", locale)}</span>}
            {late && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">{t("speakup.deadline.overdue", locale)}</span>}
          </span>
        </summary>
        <div className="space-y-3 border-t border-charcoal-ink/10 p-4">
          <p className="text-charcoal-ink/70">
            {c.anonymous ? t("speakup.raised_anon", locale) : <>{t("speakup.raised_by", locale)} <strong>{c.raised_by_name ?? "-"}</strong></>} · {t("speakup.raised_on", locale)} {lagos(c.created_at)}
            {c.screen ? ` · ${t("speakup.from_screen", locale)} ${c.screen}` : ""}
          </p>
          <div className="space-y-1">
            <Deadline label={t("speakup.deadline.acknowledge", locale)} state={d.acknowledge} due={c.acknowledge_due_at} hours={d.acknowledge === "open" || d.acknowledge === "overdue" ? Math.floor((Date.parse(c.acknowledge_due_at) - now) / 3_600_000) : null} locale={locale} />
            <Deadline label={t("speakup.deadline.respond", locale)} state={d.respond} due={c.respond_due_at} hours={d.respond === "open" || d.respond === "overdue" ? Math.floor((Date.parse(c.respond_due_at) - now) / 3_600_000) : null} locale={locale} />
          </div>
          {c.escalated_at && c.routing !== "independent_only" && <p className="text-xs text-amber-900">{t("speakup.escalated", locale)}</p>}
          {c.incident_id && <p className="text-xs text-charcoal-ink/70">{t("speakup.incident_open", locale)}</p>}
          <p className="whitespace-pre-wrap rounded-lg bg-charcoal-ink/5 p-3 text-charcoal-ink">{c.description}</p>

          {c.messages.filter((m) => m.body).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">{t("speakup.thread", locale)}</h3>
              <ul className="mt-1 space-y-1">
                {c.messages.filter((m) => m.body).map((m, i) => (
                  <li key={i} className="text-charcoal-ink/80">
                    <span className="font-medium">{t(labelKey("speakup.kind", m.kind), locale)}</span> · {lagos(m.created_at)}
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {c.state !== "closed" && (
            <div className="grid gap-4 border-t border-charcoal-ink/10 pt-3 md:grid-cols-2">
              {c.state === "new" && (
                <form action={acknowledgeConcernAction}>
                  {back}
                  <input type="hidden" name="concern" value={c.id} />
                  <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("speakup.action.acknowledge", locale)}</button>
                </form>
              )}
              <form action={respondToConcernAction} className="space-y-2">
                {back}
                <input type="hidden" name="concern" value={c.id} />
                <label className="block text-xs text-charcoal-ink">
                  {t("speakup.action.respond", locale)}
                  <textarea name="body" required minLength={20} maxLength={4000} rows={3} className={field} />
                </label>
                <p className="text-xs text-charcoal-ink/60">{t("speakup.action.respond_hint", locale)}</p>
                <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("speakup.action.respond_submit", locale)}</button>
              </form>
              {c.messages.some((m) => m.kind === "response") && (
                <form action={closeConcernAction} className="space-y-2">
                  {back}
                  <input type="hidden" name="concern" value={c.id} />
                  <label className="block text-xs text-charcoal-ink">
                    {t("speakup.action.close", locale)}
                    <textarea name="note" required minLength={20} maxLength={4000} rows={2} className={field} />
                  </label>
                  <p className="text-xs text-charcoal-ink/60">{t("speakup.action.close_hint", locale)}</p>
                  <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("speakup.action.close_submit", locale)}</button>
                </form>
              )}
              {!c.incident_id && (
                <form action={openIncidentAction} className="space-y-2">
                  {back}
                  <input type="hidden" name="concern" value={c.id} />
                  <label className="block text-xs text-charcoal-ink">
                    {t("speakup.action.incident", locale)}
                    <select name="severity" required defaultValue="" className={field}>
                      <option value="" disabled>{t("speakup.action.incident_choose", locale)}</option>
                      {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{t(`speakup.severity.${s}`, locale)}</option>)}
                    </select>
                  </label>
                  <p className="text-xs text-charcoal-ink/60">{t("speakup.action.incident_hint", locale)}</p>
                  <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("speakup.action.incident_submit", locale)}</button>
                </form>
              )}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
