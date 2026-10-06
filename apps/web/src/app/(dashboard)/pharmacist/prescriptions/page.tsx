import { t } from "@tarragon/i18n";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { loadPharmacyPrescriptions } from "@/lib/pharmacy-flags/load";
import { flagPrescriptionAction } from "@/lib/pharmacy-flags/actions";
import { asNotice, FLAG_KINDS, itemLine, kindKey, REASON_MAX, REASON_MIN } from "@/lib/pharmacy-flags/model";
import { FlashClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "Prescriptions sent to you" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/**
 * S36h (spec 9.6, pharmacy): the prescriptions sent to this pharmacy and a "Flag a problem" form on each one still waiting.
 * The role gate is the pharmacist layout; the database returns only this pharmacy's rows. Flagging never changes or dispenses anything.
 */
export default async function PharmacistPrescriptionsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  const locale = resolveUiLanguage(profile?.language, await getPidginEnabled());
  const notice = asNotice((await searchParams).n);
  const rows = await loadPharmacyPrescriptions();

  return (
    <div className="space-y-6">
      <FlashClean />
      <div>
        <h2 className="font-heading text-xl font-semibold text-charcoal-ink">{t("pharmflag.title", locale)}</h2>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("pharmflag.intro", locale)}</p>
      </div>
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice === "flagged" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
          {t(`pharmflag.notice.${notice}`, locale)}
        </p>
      )}
      {!rows.ok ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("pharmflag.load_failed", locale)}</p>
      ) : rows.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("pharmflag.empty", locale)}</p>
      ) : (
        <ul className="space-y-4">
          {rows.data.map((rx) => (
            <li key={rx.prescription_id} className="rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-charcoal-ink">
                  {rx.patient_name ?? "-"} <span className="font-normal text-charcoal-ink/60">{rx.patient_number ?? ""}</span>
                </p>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">{t(`pharmflag.state.${rx.state}`, locale)}</span>
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-charcoal-ink">
                {rx.items.map((it, i) => (
                  <li key={i}>{itemLine(it)}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-charcoal-ink/60">
                {rx.location_name ? <>{rx.location_name} · </> : null}{t("pharmflag.sent", locale)} {lagos(rx.sent_at)}
                {rx.open_flags > 0 && <> · {t("pharmflag.open_flags", locale, { count: String(rx.open_flags) })}</>}
              </p>
              {rx.state === "sent" && (
                <p className="mt-3">
                  <a href={`/pharmacist/prescriptions/${rx.prescription_id}`} className="text-sm font-semibold text-brand-green underline">
                    {t("pharmdesk.open", locale)}
                  </a>
                  {rx.code_locked && <span className="ml-2 text-xs text-amber-800">{t("pharmdesk.locked_short", locale)}</span>}
                </p>
              )}
              {rx.state === "sent" && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-clinical-navy">{t("pharmflag.flag_button", locale)}</summary>
                  <form action={flagPrescriptionAction} className="mt-3 space-y-3">
                    <input type="hidden" name="prescription" value={rx.prescription_id} />
                    <label className="block text-sm text-charcoal-ink">
                      {t("pharmflag.kind.label", locale)}
                      <select name="kind" required defaultValue="" className={field}>
                        <option value="" disabled>-</option>
                        {FLAG_KINDS.map((k) => (
                          <option key={k} value={k}>{t(kindKey(k), locale)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-charcoal-ink">
                      {t("pharmflag.reason.label", locale)}
                      <textarea name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} rows={3} className={field} />
                      <span className="text-xs text-charcoal-ink/60">{t("pharmflag.reason.hint", locale)}</span>
                    </label>
                    <button type="submit" className="rounded-lg bg-clinical-navy px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
                      {t("pharmflag.submit", locale)}
                    </button>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
