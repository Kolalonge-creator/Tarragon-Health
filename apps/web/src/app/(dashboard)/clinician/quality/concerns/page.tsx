import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadBoardReport, loadInbox, loadReaders, loadRetaliationReviews, loadStaffNames } from "@/lib/concerns/load";
import { asConcernNotice, RETALIATION_OUTCOMES, readerCandidates, sortInbox } from "@/lib/concerns/model";
import { addBackupReaderAction, closeRetaliationReviewAction, removeBackupReaderAction } from "@/lib/concerns/actions";
import { itemLabel } from "@/lib/quality/model";
import { Alert, btn, ConcernCard, field, lagos } from "@/components/concerns/concern-card";
import { BoardReportCard } from "@/components/concerns/board-report";
import { FlashClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "Safety concerns", robots: { index: false, follow: false } };
// Never cached and never static: the page shows private words and who wrote them (INV-07). Next.config adds no-store headers too.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * S36i and S20 v2: the clinical lead's concerns inbox (spec 9.5, docs/design/S20.md sections 6 and 7). Chief Medical Officer only; the
 * database functions refuse anyone who is not the lead or a named reader, and nobody on an admin or operations account is either.
 * A concern raised by the lead, or marked "about the lead", is not on this page at all: only an independent reader can read it.
 * A concern is never in an address: every action posts its id in the body and returns here with a fixed notice token.
 */
export default async function ConcernsInboxPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const profile = await getCurrentProfile();
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asConcernNotice((await searchParams).n);
  const [inbox, readers, reviews, names, board] = await Promise.all([loadInbox(), loadReaders(), loadRetaliationReviews(), loadStaffNames(), loadBoardReport()]);
  const now = new Date().getTime();
  const sorted = inbox.ok ? sortInbox(inbox.data, now) : [];
  const open = sorted.filter((c) => c.state !== "closed");
  const closed = sorted.filter((c) => c.state === "closed");
  const nameOf = (id: string) => (names.ok ? names.data.find((s) => s.profile_id === id)?.full_name : null) ?? t("speakup.readers.unknown", locale);
  const candidates = readers.ok && names.ok ? readerCandidates(names.data, readers.data, profile?.id ?? null) : [];
  const openReviews = reviews.ok ? reviews.data.filter((r) => r.state === "open") : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("speakup.lead.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("speakup.lead.intro", locale)}</p>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("speakup.lead.independent_note", locale)}</p>
      </div>

      {notice && <FlashClean />}
      {notice && (
        <p role={notice === "failed" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${notice === "failed" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`speakup.notice.${notice}`, locale)}
        </p>
      )}

      <BoardReportCard report={board} locale={locale} />

      <section aria-labelledby="inbox" className="space-y-3">
        <h2 id="inbox" className="font-heading text-xl font-semibold text-charcoal-ink">{t("speakup.open_count", locale)} ({open.length})</h2>
        {!inbox.ok ? <Alert>{t("speakup.load_error", locale)}</Alert> : open.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("speakup.none", locale)}</p> : (
          <ul className="grid gap-3">{open.map((c) => <ConcernCard key={c.id} c={c} now={now} locale={locale} returnTo="lead" />)}</ul>
        )}
        {closed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-charcoal-ink">{t("speakup.closed_heading", locale)} ({closed.length})</summary>
            <ul className="mt-2 grid gap-3">{closed.map((c) => <ConcernCard key={c.id} c={c} now={now} locale={locale} returnTo="lead" />)}</ul>
          </details>
        )}
      </section>

      <section aria-labelledby="readers" className="space-y-3">
        <div>
          <h2 id="readers" className="font-heading text-xl font-semibold text-charcoal-ink">{t("speakup.readers.title", locale)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("speakup.readers.intro", locale)}</p>
        </div>
        {!readers.ok ? <Alert>{t("speakup.load_error", locale)}</Alert> : readers.data.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("speakup.readers.none", locale)}</p> : (
          <ul className="grid gap-2">
            {readers.data.map((r) => (
              <li key={r.profile_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:bg-night-card">
                <span className="text-charcoal-ink">
                  {nameOf(r.profile_id)}{r.note ? ` · ${r.note}` : ""}
                  {r.kind === "independent" && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">{t("speakup.readers.tag.independent", locale)}</span>}
                </span>
                <form action={removeBackupReaderAction}>
                  <input type="hidden" name="profile" value={r.profile_id} />
                  <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("speakup.readers.remove", locale)}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {readers.ok && !names.ok ? <Alert>{t("speakup.readers.candidates_error", locale)}</Alert> : readers.ok && (
          <div className="grid gap-4 md:grid-cols-2">
            <form action={addBackupReaderAction} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card">
              <h3 className="font-medium text-charcoal-ink">{t("speakup.readers.add", locale)}</h3>
              <input type="hidden" name="kind" value="clinician" />
              <label className="block text-xs text-charcoal-ink">
                {t("speakup.readers.choose", locale)}
                <select name="profile" required defaultValue="" className={field}>
                  <option value="" disabled>{t("speakup.readers.choose", locale)}</option>
                  {candidates.map((s) => <option key={s.profile_id} value={s.profile_id}>{s.full_name ?? "-"}</option>)}
                </select>
              </label>
              <label className="block text-xs text-charcoal-ink">
                {t("speakup.readers.note", locale)}
                <input name="note" maxLength={300} className={field} />
              </label>
              <p className="text-xs text-charcoal-ink/60">{t("speakup.readers.no_admin", locale)}</p>
              <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("speakup.readers.submit", locale)}</button>
            </form>
            <form action={addBackupReaderAction} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card">
              <h3 className="font-medium text-charcoal-ink">{t("speakup.readers.add_independent", locale)}</h3>
              <input type="hidden" name="kind" value="independent" />
              <label className="block text-xs text-charcoal-ink">
                {t("speakup.readers.independent_id", locale)}
                <input name="independent_profile" required pattern="[0-9a-fA-F-]{36}" className={field} autoComplete="off" />
              </label>
              <label className="block text-xs text-charcoal-ink">
                {t("speakup.readers.note", locale)}
                <input name="note" maxLength={300} className={field} />
              </label>
              <p className="text-xs text-charcoal-ink/60">{t("speakup.readers.independent_hint", locale)}</p>
              <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("speakup.readers.submit_independent", locale)}</button>
            </form>
          </div>
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
                  <input type="hidden" name="return" value="lead" />
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
