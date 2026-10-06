import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadDirectoryFreshness } from "@/lib/directory-freshness/load";
import { asNotice, groupFreshness, KIND_LABEL, type FreshnessRow } from "@/lib/directory-freshness/model";
import { recordDirectoryVerificationAction } from "@/lib/directory-freshness/actions";

export const metadata = { title: "Directory freshness" };
export const dynamic = "force-dynamic";

const lagosDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "-");
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/**
 * S36g: the operations screen for directory and partner freshness (spec 25.3, 25.9). Three lists (overdue, due in 30 days, never
 * verified) and a record form per listing. Admin and operations users read it; recording needs the manage permission for that kind
 * of listing, checked in the database. Nothing here, and nothing the nightly job does, hides or switches off a listing.
 */
export default async function DirectoryFreshnessPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());
  const notice = asNotice((await searchParams).n);
  const loaded = await loadDirectoryFreshness();
  if (!loaded.ok && loaded.denied) redirect("/admin");
  const groups = loaded.ok ? groupFreshness(loaded.data) : null;
  const bad = notice === "record_failed" || notice === "record_denied" || notice === "note_short";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("dirfresh.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("dirfresh.intro", locale)}</p>
        <p className="mt-1 max-w-3xl text-xs text-charcoal-ink/60">{t("dirfresh.cadence_note", locale)}</p>
      </div>

      {notice && <FlashClean />}
      {notice && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`dirfresh.notice.${notice}`, locale)}
        </p>
      )}

      {!groups ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("dirfresh.load_error", locale)}</p>
      ) : (
        <>
          <Section id="overdue" title={t("dirfresh.overdue", locale)} empty={t("dirfresh.overdue_none", locale)} rows={groups.overdue} tone="overdue" locale={locale} />
          <Section id="soon" title={t("dirfresh.due_soon", locale)} empty={t("dirfresh.due_soon_none", locale)} rows={groups.dueSoon} tone="soon" locale={locale} />
          <Section id="never" title={t("dirfresh.never", locale)} empty={t("dirfresh.never_none", locale)} rows={groups.neverVerified} tone="never" locale={locale} />
          <p className="text-sm text-charcoal-ink/70">{t("dirfresh.current", locale, { count: groups.currentCount })}</p>
        </>
      )}
    </div>
  );
}

const TONE = { overdue: "bg-red-100 text-red-900", soon: "bg-amber-100 text-amber-900", never: "bg-sky-100 text-sky-900" } as const;

function Section({ id, title, empty, rows, tone, locale }: { id: string; title: string; empty: string; rows: FreshnessRow[]; tone: keyof typeof TONE; locale: ReturnType<typeof resolveUiLanguage> }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-heading text-xl font-semibold text-charcoal-ink">
        {title} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[tone]}`}>{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{empty}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={`${r.listing_table}:${r.listing_id}`} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-charcoal-ink">{r.name} <span className="ml-1 text-xs font-normal text-charcoal-ink/60">{KIND_LABEL[r.listing_table]}</span></p>
                <p className="text-xs text-charcoal-ink/70">
                  {t("dirfresh.last", locale)} {lagosDate(r.last_verified_at)}
                  {r.verified_by_name ? ` ${t("dirfresh.by", locale, { name: r.verified_by_name })}` : ""}
                  {r.next_verification_due ? ` · ${t("dirfresh.due", locale)} ${lagosDate(r.next_verification_due)}` : ""}
                  {r.days_overdue !== null ? ` · ${t("dirfresh.days_overdue", locale, { days: r.days_overdue })}` : ""}
                </p>
              </div>
              {r.can_record ? (
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("dirfresh.record", locale)}</summary>
                  <form action={recordDirectoryVerificationAction} className="mt-2 space-y-2">
                    <input type="hidden" name="listing_table" value={r.listing_table} />
                    <input type="hidden" name="listing_id" value={r.listing_id} />
                    <label className="block text-xs text-charcoal-ink">
                      {t("dirfresh.note", locale)}
                      <input name="note" required minLength={10} maxLength={500} className={field} />
                      <span className="mt-0.5 block text-charcoal-ink/60">{t("dirfresh.note_hint", locale)}</span>
                    </label>
                    <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("dirfresh.submit", locale)}</button>
                  </form>
                </details>
              ) : (
                <p className="text-xs text-charcoal-ink/60">{t("dirfresh.no_permission", locale)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
