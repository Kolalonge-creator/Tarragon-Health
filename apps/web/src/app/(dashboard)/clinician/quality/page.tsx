import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadAuditQueue, loadHandbackQueue, loadStaffOptions, loadTier1Progress } from "@/lib/quality/load";
import { asNotice, awaitingMe, dueLabel, HANDBACK_OUTCOMES, isFailureNotice, itemLabel, reviewerCandidates } from "@/lib/quality/model";
import { closeHandbackReviewAction, extendTier1Action, followupAction, reassignAuditAction, requestAuditAction } from "@/lib/quality/actions";
import { FlashClean as QualityNoticeClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "Quality and safety" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const DUE_STYLE = { overdue: "bg-red-100 text-red-900", unassigned: "bg-amber-100 text-amber-900", open: "bg-sky-100 text-sky-900", done: "bg-emerald-100 text-emerald-900", second: "bg-violet-100 text-violet-900" } as const;
const Alert = ({ children }: { children: React.ReactNode }) => <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{children}</p>;

/**
 * S36c and S20 v2: the clinical lead's quality and safety page (spec 9.5): the audit queue (with the second review a critical miss needs),
 * asking for an audit, moving one to another reviewer, closing a follow-up as history, the first-20 count for new clinicians and hand-back
 * reviews, over the S20 functions. Chief Medical Officer only; the functions refuse anyone else. Speak-up concerns are not on this page
 * (they are protected from operations and have their own pages). Nothing here suspends anyone or changes pay.
 */
export default async function QualityPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const profile = await getCurrentProfile();
  const me = profile?.id ?? null;
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const [audits, reviews, options] = await Promise.all([loadAuditQueue(), loadHandbackQueue(), loadStaffOptions()]);
  const open = audits.ok ? audits.data.filter((a) => dueLabel(a) !== "done") : [];
  const done = audits.ok ? audits.data.filter((a) => dueLabel(a) === "done").slice(0, 20) : [];
  const levelOne = options.ok ? options.data.filter((s) => s.credentialing_level === 1) : [];
  const progress = await Promise.all(levelOne.map(async (s) => ({ staff: s, p: await loadTier1Progress(s.id) })));
  const failed = notice ? isFailureNotice(notice) : false;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("leadquality.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("leadquality.intro", locale)}</p>
      </div>

      {notice && <QualityNoticeClean />}
      {notice && (
        <p role={failed ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${failed ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`leadquality.notice.${notice}`, locale)}
        </p>
      )}

      <section aria-labelledby="request" className="space-y-2">
        <h2 id="request" className="font-heading text-xl font-semibold text-charcoal-ink">{t("leadquality.request.title", locale)}</h2>
        <form action={requestAuditAction} className="flex max-w-xl flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-charcoal-ink">
            {t("leadquality.request.label", locale)}
            <input name="task" required pattern="\s*[0-9a-fA-F-]{36}\s*" autoComplete="off" className={field} />
          </label>
          <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("leadquality.request.submit", locale)}</button>
        </form>
        <p className="text-xs text-charcoal-ink/60">{t("leadquality.request.hint", locale)}</p>
      </section>

      <section aria-labelledby="audits" className="space-y-3">
        <h2 id="audits" className="font-heading text-xl font-semibold text-charcoal-ink">{t("leadquality.audits.title", locale)}</h2>
        {!audits.ok ? (
          <Alert>{t("leadquality.load_error", locale)}</Alert>
        ) : open.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("leadquality.audits.none", locale)}</p>
        ) : (
          <ul className="grid gap-2">
            {open.map((a) => {
              const due = dueLabel(a);
              const mine = awaitingMe(a, me);
              const candidates = options.ok ? reviewerCandidates(options.data, a.clinician_id) : [];
              return (
                <li key={a.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-charcoal-ink">{a.clinician_name ?? "-"} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${DUE_STYLE[due]}`}>{t(`leadquality.due.${due}`, locale)}</span></p>
                      <p className="text-charcoal-ink/60">
                        {itemLabel(a.reason)} · {t("leadquality.due_at", locale)} {lagos(a.due_at)}
                        {a.counts_toward_tier1 ? ` · ${t("leadquality.tier1", locale)}` : ""}
                        {a.scribe_assisted ? ` · ${t("leadquality.scribe_tag", locale)}` : ""}
                      </p>
                    </div>
                    {mine ? (
                      <Link href={`/clinician/quality/audits/${a.id}`} className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{a.state === "submitted" ? t("leadquality.audits.open_second", locale) : t("leadquality.audits.open", locale)}</Link>
                    ) : (
                      <span className="text-xs text-charcoal-ink/60">{t("leadquality.audits.with_other", locale)}</span>
                    )}
                  </div>
                  {a.state !== "submitted" && candidates.length > 0 && (
                    <form action={reassignAuditAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="audit" value={a.id} />
                      <label className="text-xs text-charcoal-ink">
                        {t("leadquality.reassign.label", locale)}
                        <select name="reviewer" required defaultValue="" className={field}>
                          <option value="" disabled>{t("leadquality.reassign.choose", locale)}</option>
                          {candidates.map((c) => <option key={c.id} value={c.profile_id ?? ""}>{c.full_name ?? "-"}</option>)}
                        </select>
                      </label>
                      <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("leadquality.reassign.submit", locale)}</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {done.length > 0 && (
          <div className="space-y-2 text-sm">
            <h3 className="font-medium text-charcoal-ink">{t("leadquality.audits.recent", locale)}</h3>
            <ul className="grid gap-2">
              {done.map((a) => (
                <li key={a.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 dark:bg-night-card">
                  <p className="text-charcoal-ink/80">
                    {a.clinician_name ?? "-"} · {itemLabel(a.final_outcome ?? a.outcome ?? "")} {a.total_score !== null ? `(${a.total_score})` : ""} · {lagos(a.submitted_at)}
                    {a.second_review_required ? ` · ${t(a.second_review_agrees === false ? "leadquality.second.disagreed" : "leadquality.second.agreed", locale)}` : ""}
                    {a.replies ? ` · ${t("leadquality.replies", locale, { count: a.replies })}` : ""}
                    <Link href={`/clinician/quality/audits/${a.id}`} className="ml-3 underline">{t("leadquality.audits.view", locale)}</Link>
                  </p>
                  {a.followup_needed && (
                    <form action={followupAction} className="space-y-2">
                      <input type="hidden" name="audit" value={a.id} />
                      <label className="block text-xs text-charcoal-ink">
                        {t("leadquality.followup", locale)}
                        <textarea name="note" required minLength={20} maxLength={2000} rows={2} className={field} />
                      </label>
                      <p className="text-xs text-charcoal-ink/60">{t("leadquality.followup.hint", locale)}</p>
                      <div className="flex gap-2">
                        <button type="submit" name="kind" value="note" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("leadquality.followup.note", locale)}</button>
                        <button type="submit" name="kind" value="close" className={`${btn} bg-brand-green text-white`}>{t("leadquality.followup.close", locale)}</button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="tier1" className="space-y-3">
        <div>
          <h2 id="tier1" className="font-heading text-xl font-semibold text-charcoal-ink">{t("leadquality.tier1.title", locale)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("leadquality.tier1.intro", locale)}</p>
        </div>
        {!options.ok ? (
          <Alert>{t("leadquality.load_error", locale)}</Alert>
        ) : progress.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("leadquality.tier1.none", locale)}</p>
        ) : (
          <ul className="grid gap-3">
            {progress.map(({ staff: s, p }) => (
              <li key={s.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card">
                <p className="font-medium text-charcoal-ink">{s.full_name ?? "-"}</p>
                {p.ok ? (
                  <p className="text-charcoal-ink/70">
                    {t("leadquality.tier1.progress", locale, { done: p.data.submitted, target: p.data.target })}
                    {p.data.average_score !== null ? ` · ${t("leadquality.tier1.average", locale, { score: p.data.average_score, min: p.data.graduation_min_score })}` : ""}
                    {p.data.critical_misses > 0 ? ` · ${t("leadquality.tier1.misses", locale, { count: p.data.critical_misses })}` : ""}
                  </p>
                ) : (
                  <Alert>{t("leadquality.load_error", locale)}</Alert>
                )}
                <form action={extendTier1Action} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="staff" value={s.id} />
                  <label className="text-xs text-charcoal-ink">
                    {t("leadquality.tier1.extra", locale)}
                    <input name="extra" type="number" min={1} max={20} required defaultValue={5} className={`${field} w-24`} />
                  </label>
                  <label className="min-w-0 flex-1 text-xs text-charcoal-ink">
                    {t("leadquality.tier1.reason", locale)}
                    <input name="reason" required minLength={10} maxLength={500} className={field} />
                  </label>
                  <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("leadquality.tier1.extend", locale)}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="handbacks" className="space-y-3">
        <div>
          <h2 id="handbacks" className="font-heading text-xl font-semibold text-charcoal-ink">{t("leadquality.handbacks.title", locale)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("leadquality.handbacks.intro", locale)}</p>
        </div>
        {!reviews.ok ? (
          <Alert>{t("leadquality.load_error", locale)}</Alert>
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
