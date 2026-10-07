import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { loadPharmacyPrescriptions } from "@/lib/pharmacy-flags/load";
import { itemLine } from "@/lib/pharmacy-flags/model";

export const metadata = { title: "Prescriptions sent to you" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

/**
 * Prescriptions sent to this pharmacy (S28, spec 9.6). The list is one audited read. Opening one goes to the counter, where the code is
 * checked and the supply recorded, and where a question to the prescriber is chosen from a fixed list (S28c: no free text, no chat).
 * The role gate is the pharmacist layout; the database returns only this pharmacy's rows.
 */
export default async function PharmacistPrescriptionsPage() {
  const locale = DEFAULT_UI_LANGUAGE;
  const rows = await loadPharmacyPrescriptions();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-semibold text-charcoal-ink">{t("pharmflag.title", locale)}</h2>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("pharmflag.intro", locale)}</p>
      </div>
      {!rows.ok && rows.off ? (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Pharmacy collection is not switched on yet. Nothing is waiting.</p>
      ) : !rows.ok ? (
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
