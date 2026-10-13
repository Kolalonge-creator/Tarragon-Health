import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadAuditQueue, loadHandbackQueue } from "@/lib/quality/load";
import { asNotice, dueLabel, HANDBACK_OUTCOMES, itemLabel } from "@/lib/quality/model";
import { closeHandbackReviewAction } from "@/lib/quality/actions";
import { FlashClean as QualityNoticeClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "Quality and safety" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const DUE_STYLE = { overdue: "bg-red-100 text-red-900", unassigned: "bg-amber-100 text-amber-900", open: "bg-sky-100 text-sky-900", done: "bg-emerald-100 text-emerald-900" } as const;

/**
 * S36c: the clinical lead's quality and safety page (spec 9.5): the audit queue and hand-back reviews, over the S20 functions.
 * Chief Medical Officer only; the functions refuse anyone else. Speak-up concerns are not on this page (a later piece, they are
 * deliberately protected from operations and need their own review before a screen exists). Nothing here suspends or changes pay.
 */
export default async function QualityPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const profile = await getCurrentProfile();
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const [audits, reviews] = await Promise.all([loadAuditQueue(), loadHandbackQueue()]);
  const open = audits.ok ? audits.data.filter((a) => dueLabel(a) !== "done") : [];
  const done = audits.ok ? audits.data.filter((a) => dueLabel(a) === "done").slice(0, 20) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("leadquality.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("leadquality.intro", locale)}</p>
      </div>

      {notice && <QualityNoticeClean />}
      {notice && (
        <p role={notice.endsWith("failed") || notice === "audit_incomplete" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${notice.endsWith("failed") || notice === "audit_incomplete" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`leadquality.notice.${notice}`, locale)}
        </p>
      )}

      <section aria-labelledby="audits" className="space-y-3">
        <h2 id="audits" className="font-heading text-xl font-semibold text-charcoal-ink">{t("leadquality.audits.title", locale)}</h2>
        {!audits.ok ? (
          <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("leadquality.load_error", locale)}</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("leadquality.audits.none", locale)}</p>
        ) : (
          <ul className="grid gap-2">
            {open.map((a) => {
              const due = dueLabel(a);
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                  <div>
                    <p className="font-medium text-charcoal-ink">{a.clinician_name ?? "-"} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${DUE_STYLE[due]}`}>{t(`leadquality.due.${due}`, locale)}</span></p>
                    <p className="text-charcoal-ink/60">{itemLabel(a.reason)} · {t("leadquality.due_at", locale)} {lagos(a.due_at)}{a.counts_toward_tier1 ? ` · ${t("leadquality.tier1", locale)}` : ""}</p>
                  </div>
                  <Link href={`/clinician/quality/audits/${a.id}`} className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("leadquality.audits.open", locale)}</Link>
                </li>
              );
            })}
          </ul>
        )}
        {done.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-charcoal-ink">{t("leadquality.audits.recent", locale)}</summary>
            <ul className="mt-2 grid gap-1 text-charcoal-ink/80">
              {done.map((a) => (
                <li key={a.id}>{a.clinician_name ?? "-"} · {itemLabel(a.outcome ?? "")} {a.total_score !== null ? `(${a.total_score})` : ""} · {lagos(a.submitted_at)}{a.followup_needed ? ` · ${t("leadquality.followup", locale)}` : ""}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="handbacks" className="space-y-3">
        <div>
          <h2 id="handbacks" className="font-heading text-xl font-semibold text-charcoal-ink">{t("leadquality.handbacks.title", locale)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("leadquality.handbacks.intro", locale)}</p>
        </div>
        {!reviews.ok ? (
          <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("leadquality.load_error", locale)}</p>
        ) : reviews.data.filter((r) => r.state === "open").length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("leadquality.handbacks.none", locale)}</p>
        ) : (
          <ul className="grid gap-3">
            {reviews.data.filter((r) => r.state === "open").map((r) => (
              <li key={r.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:border-night-ink/15 dark:bg-night-card">
                <p className="font-medium text-charcoal-ink">{r.clinician_name ?? "-"}</p>
                <p className="text-charcoal-ink/70">
                  {t("leadquality.handbacks.count", locale, { count: r.handbacks ?? 0, days: r.window_days ?? 0 })}
                  {r.reasons && Object.keys(r.reasons).length > 0 ? ` · ${Object.entries(r.reasons).map(([k, v]) => `${itemLabel(k)} ${v}`).join(", ")}` : ""}
                  {r.reliability_score !== null ? ` · ${t("leadquality.handbacks.reliability", locale)} ${r.reliability_score}` : ""}
                </p>
                <form action={closeHandbackReviewAction} className="space-y-2">
                  <input type="hidden" name="review" value={r.id} />
                  <label className="block text-xs text-charcoal-ink">
                    {t("leadquality.handbacks.outcome", locale)}
                    <select name="outcome" required defaultValue="" className={field}>
                      <option value="" disabled>{t("leadquality.handbacks.choose", locale)}</option>
                      {HANDBACK_OUTCOMES.map((o) => <option key={o} value={o}>{t(`leadquality.outcome.${o}`, locale)}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs text-charcoal-ink">
                    {t("leadquality.handbacks.note", locale)}
                    <input name="note" required minLength={10} maxLength={1000} className={field} />
                  </label>
                  <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("leadquality.handbacks.close", locale)}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
