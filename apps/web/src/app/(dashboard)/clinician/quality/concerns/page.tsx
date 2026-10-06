import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { loadInbox, loadReaders, loadRetaliationReviews, loadStaffNames } from "@/lib/concerns/load";
import {
  asConcernNotice,
  deadlines,
  labelKey,
  INCIDENT_SEVERITIES,
  RETALIATION_OUTCOMES,
  readerCandidates,
  sortInbox,
  type DeadlineState,
  type InboxRow,
} from "@/lib/concerns/model";
import {
  acknowledgeConcernAction,
  addBackupReaderAction,
  closeConcernAction,
  closeRetaliationReviewAction,
  openIncidentAction,
  removeBackupReaderAction,
  respondToConcernAction,
} from "@/lib/concerns/actions";
import { itemLabel } from "@/lib/quality/model";
import { FlashClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "Safety concerns", robots: { index: false, follow: false } };
// Never cached and never static: the page shows private words and who wrote them (INV-07). Next.config adds no-store headers too.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Locale = ReturnType<typeof resolveUiLanguage>;
const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const DEADLINE_STYLE: Record<DeadlineState, string> = { overdue: "bg-red-100 text-red-900", open: "bg-sky-100 text-sky-900", done: "bg-emerald-100 text-emerald-900" };
const Alert = ({ children }: { children: React.ReactNode }) => (
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

function ConcernCard({ c, now, locale }: { c: InboxRow; now: number; locale: Locale }) {
  const d = deadlines(c, now);
  const late = d.acknowledge === "overdue" || d.respond === "overdue";
  return (
    <li className={`rounded-xl border bg-white text-sm dark:bg-night-card ${late ? "border-red-300" : "border-charcoal-ink/10 dark:border-night-ink/15"}`}>
      <details open={c.state !== "closed"}>
        <summary className="cursor-pointer space-y-1 p-4">
          <span className="font-medium text-charcoal-ink">
            {t(labelKey("concern.category", c.category), locale)} · {t(labelKey("concern.severity", c.severity), locale)}
            <span className="ml-2 rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs font-semibold">{t(`speakup.state.${c.state}`, locale)}</span>
            {late && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">{t("speakup.deadline.overdue", locale)}</span>}
          </span>
        </summary>
        <div className="space-y-3 border-t border-charcoal-ink/10 p-4">
          <p className="text-charcoal-ink/70">
            {t("speakup.raised_by", locale)} <strong>{c.raised_by_name ?? "-"}</strong> · {t("speakup.raised_on", locale)} {lagos(c.created_at)}
            {c.screen ? ` · ${t("speakup.from_screen", locale)} ${c.screen}` : ""}
          </p>
          <div className="space-y-1">
            <Deadline label={t("speakup.deadline.acknowledge", locale)} state={d.acknowledge} due={c.acknowledge_due_at} hours={d.acknowledge === "open" || d.acknowledge === "overdue" ? Math.floor((Date.parse(c.acknowledge_due_at) - now) / 3_600_000) : null} locale={locale} />
            <Deadline label={t("speakup.deadline.respond", locale)} state={d.respond} due={c.respond_due_at} hours={d.respond === "open" || d.respond === "overdue" ? Math.floor((Date.parse(c.respond_due_at) - now) / 3_600_000) : null} locale={locale} />
          </div>
          {c.escalated_at && <p className="text-xs text-amber-900">{t("speakup.escalated", locale)}</p>}
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
                  <input type="hidden" name="concern" value={c.id} />
                  <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("speakup.action.acknowledge", locale)}</button>
                </form>
              )}
              <form action={respondToConcernAction} className="space-y-2">
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

/**
 * S36i: the clinical lead's concerns inbox (spec 9.5, docs/design/S20.md sections 6 and 7). Chief Medical Officer only; the
 * database functions refuse anyone who is not the lead or a named backup reader, and nobody on an admin or operations account is
 * either. A concern is never in an address: every action posts its id in the body and returns here with a fixed notice token.
 */
export default async function ConcernsInboxPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const profile = await getCurrentProfile();
  const locale = resolveUiLanguage(profile?.language, await getPidginEnabled());
  const notice = asConcernNotice((await searchParams).n);
  const [inbox, readers, reviews, names] = await Promise.all([loadInbox(), loadReaders(), loadRetaliationReviews(), loadStaffNames()]);
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
      </div>

      {notice && <FlashClean />}
      {notice && (
        <p role={notice === "failed" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${notice === "failed" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`speakup.notice.${notice}`, locale)}
        </p>
      )}

      <section aria-labelledby="inbox" className="space-y-3">
        <h2 id="inbox" className="font-heading text-xl font-semibold text-charcoal-ink">{t("speakup.open_count", locale)} ({open.length})</h2>
        {!inbox.ok ? <Alert>{t("speakup.load_error", locale)}</Alert> : open.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("speakup.none", locale)}</p> : (
          <ul className="grid gap-3">{open.map((c) => <ConcernCard key={c.id} c={c} now={now} locale={locale} />)}</ul>
        )}
        {closed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-charcoal-ink">{t("speakup.closed_heading", locale)} ({closed.length})</summary>
            <ul className="mt-2 grid gap-3">{closed.map((c) => <ConcernCard key={c.id} c={c} now={now} locale={locale} />)}</ul>
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
                <span className="text-charcoal-ink">{nameOf(r.profile_id)}{r.note ? ` · ${r.note}` : ""}</span>
                <form action={removeBackupReaderAction}>
                  <input type="hidden" name="profile" value={r.profile_id} />
                  <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("speakup.readers.remove", locale)}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {readers.ok && !names.ok ? <Alert>{t("speakup.readers.candidates_error", locale)}</Alert> : readers.ok && (
          <form action={addBackupReaderAction} className="max-w-xl space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card">
            <h3 className="font-medium text-charcoal-ink">{t("speakup.readers.add", locale)}</h3>
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
            <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("speakup.readers.submit", locale)}</button>
          </form>
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
