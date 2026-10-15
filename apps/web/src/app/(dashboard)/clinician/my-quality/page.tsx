import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { loadMyQuality } from "@/lib/quality/load";
import { itemLabel } from "@/lib/quality/model";
import { replyToAuditAction } from "@/lib/quality/actions";
import { FlashClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "My quality", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "-");
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const NOTICES = ["reply_sent", "reply_failed"] as const;

/**
 * S20 v2: what the clinician sees about their own audited work. Only finished audits (a critical miss waits for its second reader and is
 * not shown until it is final), the first-20 count for a new clinician, and the advisory reliability score. The score is a tie-break for
 * the queue only; it never decides pay or removal without the clinical lead. The clinician can reply to any finished audit; the reply is
 * kept as written and the clinical lead is told it exists (without its words).
 */
export default async function MyQualityPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  if ((await getCurrentClinicalStaff()) === null) redirect("/clinician");
  const locale = DEFAULT_UI_LANGUAGE;
  const n = (await searchParams).n;
  const notice = (NOTICES as readonly unknown[]).includes(n) ? (n as (typeof NOTICES)[number]) : null;
  const mine = await loadMyQuality();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("myquality.title", locale)}</h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">{t("myquality.intro", locale)}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={notice === "reply_failed" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${notice === "reply_failed" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`myquality.notice.${notice}`, locale)}
        </p>
      )}
      {!mine.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("leadquality.load_error", locale)}</p>
      ) : (
        <>
          <section className="rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card" aria-labelledby="summary">
            <h2 id="summary" className="font-heading text-lg font-semibold text-charcoal-ink">{t("myquality.summary", locale)}</h2>
            <p className="mt-1 text-charcoal-ink/80">
              {t("myquality.reliability", locale)}: {mine.data.reliability_score === null ? t("myquality.reliability_none", locale) : mine.data.reliability_score}
            </p>
            <p className="mt-1 text-xs text-charcoal-ink/60">{t("myquality.reliability_hint", locale)}</p>
            {mine.data.tier1 && (
              <p className="mt-3 text-charcoal-ink/80">
                {t("leadquality.tier1.progress", locale, { done: mine.data.tier1.submitted, target: mine.data.tier1.target })}
                {mine.data.tier1.average_score !== null ? ` · ${t("leadquality.tier1.average", locale, { score: mine.data.tier1.average_score, min: mine.data.tier1.graduation_min_score })}` : ""}
              </p>
            )}
          </section>
          <section aria-labelledby="audits" className="space-y-3">
            <h2 id="audits" className="font-heading text-lg font-semibold text-charcoal-ink">{t("myquality.audits", locale)}</h2>
            {mine.data.audits.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("myquality.none", locale)}</p> : (
              <ul className="grid gap-3">
                {mine.data.audits.map((a) => (
                  <li key={a.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card">
                    <p className="font-medium text-charcoal-ink">
                      {itemLabel(a.outcome ?? "")} {a.total_score !== null ? `(${a.total_score})` : ""} <span className="ml-2 text-xs font-normal text-charcoal-ink/60">{lagos(a.final_at ?? a.submitted_at)} · {itemLabel(a.reason)}</span>
                    </p>
                    {a.rationale && <p className="whitespace-pre-wrap text-charcoal-ink/80">{a.rationale}</p>}
                    {a.avoidability && <p className="text-charcoal-ink/70">{t("leadquality.form.avoidability", locale)}: {itemLabel(a.avoidability)}</p>}
                    {a.phase_comments && (
                      <dl className="grid gap-1 sm:grid-cols-2">
                        {Object.entries(a.phase_comments).map(([k, v]) => <div key={k}><dt className="text-xs text-charcoal-ink/60">{itemLabel(k)}</dt><dd className="whitespace-pre-wrap text-charcoal-ink">{v}</dd></div>)}
                      </dl>
                    )}
                    {a.replies.length > 0 && (
                      <ul className="space-y-1">
                        {a.replies.map((r, i) => <li key={i} className="text-charcoal-ink/80"><span className="text-xs text-charcoal-ink/60">{t("myquality.your_reply", locale)} · {lagos(r.at)}</span><p className="whitespace-pre-wrap">{r.body}</p></li>)}
                      </ul>
                    )}
                    <form action={replyToAuditAction} className="space-y-2">
                      <input type="hidden" name="audit" value={a.id} />
                      <label className="block text-xs text-charcoal-ink">
                        {t("myquality.reply", locale)}
                        <textarea name="body" required minLength={20} maxLength={4000} rows={2} className={field} />
                      </label>
                      <button type="submit" className="rounded-lg border border-charcoal-ink/20 px-3 py-1.5 text-sm font-semibold text-charcoal-ink">{t("myquality.reply_submit", locale)}</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
