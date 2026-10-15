import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { loadBoardReport, loadInbox, loadReaderStatus, loadRetaliationReviews } from "@/lib/concerns/load";
import { asConcernNotice, RETALIATION_OUTCOMES, sortInbox } from "@/lib/concerns/model";
import { closeRetaliationReviewAction } from "@/lib/concerns/actions";
import { itemLabel } from "@/lib/quality/model";
import { Alert, btn, ConcernCard, field, lagos } from "@/components/concerns/concern-card";
import { BoardReportCard } from "@/components/concerns/board-report";
import { FlashClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "Concerns you read", robots: { index: false, follow: false } };
// Never cached and never static: the page shows private words (INV-07). Next.config adds no-store headers too.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * S20 v2: the readers' screen. A named reader (a clinician colleague, or an independent person who may have no clinician login) reads
 * the concerns the database lets them read: escalated ones for a clinician reader, and the ones raised by or about the clinical lead for
 * an independent reader. An admin account is never a reader and is sent away. The lead's page is separate; this one is for everyone else.
 */
export default async function ReaderConcernsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const status = await loadReaderStatus();
  if (status.ok && !status.data.is_reader) redirect("/");
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asConcernNotice((await searchParams).n);
  const [inbox, reviews, board] = await Promise.all([loadInbox(), loadRetaliationReviews(), loadBoardReport()]);
  const now = new Date().getTime();
  const sorted = inbox.ok ? sortInbox(inbox.data, now) : [];
  const open = sorted.filter((c) => c.state !== "closed");
  const closed = sorted.filter((c) => c.state === "closed");
  const openReviews = reviews.ok ? reviews.data.filter((r) => r.state === "open") : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("speakup.reader.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("speakup.reader.intro", locale)}</p>
      </div>

      {notice && <FlashClean />}
      {notice && (
        <p role={notice === "failed" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${notice === "failed" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`speakup.notice.${notice}`, locale)}
        </p>
      )}
      {!status.ok && <Alert>{t("speakup.load_error", locale)}</Alert>}

      <BoardReportCard report={board} locale={locale} />

      <section aria-labelledby="inbox" className="space-y-3">
        <h2 id="inbox" className="font-heading text-xl font-semibold text-charcoal-ink">{t("speakup.open_count", locale)} ({open.length})</h2>
        {!inbox.ok ? <Alert>{t("speakup.load_error", locale)}</Alert> : open.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("speakup.none", locale)}</p> : (
          <ul className="grid gap-3">{open.map((c) => <ConcernCard key={c.id} c={c} now={now} locale={locale} returnTo="reader" />)}</ul>
        )}
        {closed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-charcoal-ink">{t("speakup.closed_heading", locale)} ({closed.length})</summary>
            <ul className="mt-2 grid gap-3">{closed.map((c) => <ConcernCard key={c.id} c={c} now={now} locale={locale} returnTo="reader" />)}</ul>
          </details>
        )}
      </section>

      <section aria-labelledby="retaliation" className="space-y-3">
        <div>
          <h2 id="retaliation" className="font-heading text-xl font-semibold text-charcoal-ink">{t("speakup.retaliation.title", locale)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("speakup.retaliation.intro", locale)}</p>
        </div>
        {!reviews.ok ? <Alert>{t("speakup.load_error", locale)}</Alert> : openReviews.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("speakup.retaliation.none", locale)}</p> : (
          <ul className="grid gap-3">
            {openReviews.map((r) => (
              <li key={r.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card">
                <p className="font-medium text-charcoal-ink">{r.clinician_name ?? "-"} · {itemLabel(r.trigger_kind)} · {lagos(r.created_at)}</p>
                <form action={closeRetaliationReviewAction} className="space-y-2">
                  <input type="hidden" name="return" value="reader" />
                  <input type="hidden" name="review" value={r.id} />
                  <label className="block text-xs text-charcoal-ink">
                    {t("speakup.retaliation.outcome", locale)}
                    <select name="outcome" required defaultValue="" className={field}>
                      <option value="" disabled>{t("speakup.retaliation.choose", locale)}</option>
                      {RETALIATION_OUTCOMES.map((o) => <option key={o} value={o}>{t(`speakup.retaliation.outcome.${o}`, locale)}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs text-charcoal-ink">
                    {t("speakup.retaliation.note", locale)}
                    <input name="note" required minLength={10} maxLength={1000} className={field} />
                  </label>
                  <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("speakup.retaliation.submit", locale)}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
