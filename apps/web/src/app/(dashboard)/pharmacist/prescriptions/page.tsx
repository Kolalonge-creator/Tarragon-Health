import { t, type MessageKey } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { loadPharmacyPrescriptions } from "@/lib/pharmacy-flags/load";
import { itemLine } from "@/lib/pharmacy-flags/model";
import { loadCollectionExtras } from "@/lib/pharmacy-collection/desk-load";
import { groupByVisit, STOCK_OUTCOMES } from "@/lib/pharmacy-collection/model";
import { confirmStockAction } from "@/lib/pharmacy-collection/stock-actions";

export const metadata = { title: "Prescriptions sent to you" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

const asStockNote = (v: unknown): (typeof STOCK_OUTCOMES)[number] | "failed" | null =>
  v === "failed" ? "failed" : (STOCK_OUTCOMES as readonly unknown[]).includes(v) ? (v as (typeof STOCK_OUTCOMES)[number]) : null;

const smallButton = "rounded-lg border border-brand-green px-2.5 py-1 text-xs font-semibold text-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clinical-navy";

/**
 * Prescriptions sent to this pharmacy (S28, spec 9.6). The list is one audited read. Opening one goes to the counter, where the code is
 * checked and the supply recorded, and where a question to the prescriber is chosen from a fixed list (S28c: no free text, no chat).
 * S28e: prescriptions the patient sent together are marked as one visit and open together; each waiting one gets a plain yes or no for stock.
 * The role gate is the pharmacist layout; the database returns only this pharmacy's rows.
 */
export default async function PharmacistPrescriptionsPage({ searchParams }: { searchParams?: Promise<{ s?: string }> } = {}) {
  const locale = DEFAULT_UI_LANGUAGE;
  const rows = await loadPharmacyPrescriptions();
  const note = asStockNote((await searchParams)?.s);
  // Only worth asking once the list itself loaded; a failed grouping read leaves the list usable and says so.
  const extras = rows.ok && rows.data.some((r) => r.state === "sent") ? await loadCollectionExtras() : null;
  const byId = new Map((extras?.ok ? extras.data : []).map((e) => [e.prescription_id, e]));
  const visits = groupByVisit(extras?.ok ? extras.data : []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-semibold text-charcoal-ink">{t("pharmflag.title", locale)}</h2>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("pharmflag.intro", locale)}</p>
      </div>
      {note && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${note === "confirmed" || note === "out_of_stock" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
          {t(`pharmstock.notice.${note}` as MessageKey, locale)}
        </p>
      )}
      {extras && !extras.ok && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("pharmvisitdesk.extras_failed", locale)}</p>}
      {!rows.ok && rows.off ? (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Pharmacy collection is not switched on yet. Nothing is waiting.</p>
      ) : !rows.ok ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("pharmflag.load_failed", locale)}</p>
      ) : rows.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("pharmflag.empty", locale)}</p>
      ) : (
        <ul className="space-y-4">
          {rows.data.map((rx) => {
            const extra = byId.get(rx.prescription_id);
            const visitMates = extra?.visit_id ? (visits.get(extra.visit_id) ?? []).length - 1 : 0;
            return (
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
                  <div className="mt-3 space-y-2">
                    <p>
                      <a href={`/pharmacist/prescriptions/${rx.prescription_id}`} className="text-sm font-semibold text-brand-green underline">
                        {t("pharmdesk.open", locale)}
                      </a>
                      {rx.code_locked && <span className="ml-2 text-xs text-amber-800">{t("pharmdesk.locked_short", locale)}</span>}
                    </p>
                    {extra?.visit_id && visitMates > 0 && (
                      <p className="text-xs text-charcoal-ink/70">
                        {t("pharmvisitdesk.group", locale, { count: visitMates })}{" "}
                        <a href={`/pharmacist/prescriptions/visit/${extra.visit_id}`} className="font-semibold text-brand-green underline">{t("pharmvisitdesk.open", locale)}</a>
                      </p>
                    )}
                    <form action={confirmStockAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="prescription" value={rx.prescription_id} />
                      <button type="submit" name="answer" value="yes" className={smallButton}>{t("pharmstock.have", locale)}</button>
                      {/* a no cannot be taken back (it tells the patient and opens a task), so it takes a second press */}
                      <details className="inline-block">
                        <summary className="cursor-pointer rounded-lg border border-charcoal-ink/30 px-2.5 py-1 text-xs font-semibold text-charcoal-ink">{t("pharmstock.none", locale)}</summary>
                        <div className="mt-1 space-y-1 rounded-lg border border-charcoal-ink/15 bg-white p-2 text-xs">
                          <p>{t("pharmstock.none_confirm", locale)}</p>
                          <button type="submit" name="answer" value="no" className={smallButton}>{t("pharmstock.none_send", locale)}</button>
                        </div>
                      </details>
                      <span className="text-xs text-charcoal-ink/70">
                        {extra?.stock_confirmed_at ? t("pharmstock.confirmed_at", locale, { date: lagos(extra.stock_confirmed_at) }) : t("pharmstock.not_answered", locale)}
                      </span>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.ok && rows.data.some((r) => r.state === "sent") && <p className="text-xs text-charcoal-ink/60">{t("pharmstock.caveat", locale)}</p>}
    </div>
  );
}
