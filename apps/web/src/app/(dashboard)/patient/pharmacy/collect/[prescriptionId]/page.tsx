import { notFound } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { loadCollection, loadPharmacies, loadPriceCompare } from "@/lib/pharmacy-collection/load";
import { choosePharmacyAction, newCodeAction } from "@/lib/pharmacy-collection/actions";
import { asNotice, nairaFromKobo, stockKey, viewFor, type PharmacyOption, type PriceRow } from "@/lib/pharmacy-collection/model";
import { FlashClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "Collect your medicine" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "");
/**
 * S54 8.9: the price and stock comparison. The patient reads it and then chooses; nothing here chooses for her, and nothing in it
 * (or anywhere a clinician can read) says what Tarragon earns from a pharmacy (8.16). Ordered by items supplied, stock, then price.
 */
function PriceCompare({ rows, locale }: { rows: PriceRow[]; locale: Locale }) {
  if (rows.length === 0) return <p className="text-sm text-charcoal-ink/70">{t("pharmprice.none", locale)}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.location_id} className="rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold text-charcoal-ink">{r.partner_name}</p>
            <p className="font-semibold text-charcoal-ink">{t("pharmprice.total", locale, { amount: nairaFromKobo(r.total_kobo) })}</p>
          </div>
          <p className="text-sm text-charcoal-ink/70">{[r.location_name, r.address, r.state].filter(Boolean).join(", ")}</p>
          <p className="mt-1 text-sm text-charcoal-ink/80">
            {r.items_matched < r.items_total ? `${t("pharmprice.partial", locale, { matched: r.items_matched, total: r.items_total })}. ` : ""}
            {r.lines.some((l) => l.stock === "unavailable")
              ? t("pharmprice.some_unavailable", locale)
              : r.all_in_stock
                ? r.any_low_stock ? t("pharmprice.low_stock", locale) : t("pharmprice.in_stock", locale)
                : t("pharmprice.unknown_stock", locale)}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-charcoal-ink/70">
            {r.lines.map((l) => (
              <li key={l.item}>
                {l.drug}{l.pack ? ` (${l.pack})` : ""}: {nairaFromKobo(l.price_kobo)}, {t(stockKey(l.stock), locale)}
                {l.strength_confirmed ? "" : `, ${t("pharmprice.strength_unconfirmed", locale)}`}
              </li>
            ))}
          </ul>
          {r.all_verified_batch && <p className="mt-1 text-xs text-emerald-900">{t("pharmprice.verified", locale)}</p>}
          {r.prices_updated_at && <p className="mt-1 text-xs text-charcoal-ink/60">{t("pharmprice.updated", locale, { date: lagos(r.prices_updated_at) })}</p>}
        </li>
      ))}
      <li className="text-xs text-charcoal-ink/60">{t("pharmprice.verified_caveat", locale)}</li>
    </ul>
  );
}

const button = "rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clinical-navy";

function Chooser({ id, options, locale }: { id: string; options: PharmacyOption[]; locale: Locale }) {
  if (options.length === 0) return <p className="text-sm text-charcoal-ink/70">{t("pharmcollect.none", locale)}</p>;
  return (
    <ul className="space-y-3">
      {options.map((o) => (
        <li key={o.location_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
          <div>
            <p className="font-semibold text-charcoal-ink">{o.partner_name}</p>
            <p className="text-sm text-charcoal-ink/70">{[o.location_name, o.address, o.state].filter(Boolean).join(", ")}</p>
          </div>
          <form action={choosePharmacyAction}>
            <input type="hidden" name="prescription" value={id} />
            <input type="hidden" name="partner" value={o.partner_id} />
            <input type="hidden" name="location" value={o.location_id} />
            <button type="submit" className={button}>{t("pharmcollect.pick", locale)}</button>
          </form>
        </li>
      ))}
    </ul>
  );
}

/**
 * S28 (spec 9.6, 8.9): the patient picks a verified pharmacy to collect a signed prescription from and reads her collection code.
 * Collection only, no delivery, no payment here (she pays the pharmacy). The database decides everything; this page only shows it.
 */
export default async function CollectPage({ params, searchParams }: { params: Promise<{ prescriptionId: string }>; searchParams: Promise<{ n?: string }> }) {
  const { prescriptionId } = await params;
  if (!UUID.test(prescriptionId)) notFound();
  const locale: Locale = "en";
  const notice = asNotice((await searchParams).n);
  const collection = await loadCollection(prescriptionId);
  if (collection.ok && !collection.data) notFound();
  const view = collection.ok && collection.data ? viewFor(collection.data) : null;
  const pharmacies = view === "choose" || view === "code" ? await loadPharmacies(prescriptionId) : null;
  const prices = view === "choose" ? await loadPriceCompare(prescriptionId) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <FlashClean />
      <div>
        <h2 className="font-heading text-xl font-semibold text-charcoal-ink">{t("pharmcollect.title", locale)}</h2>
        <p className="mt-1 text-sm text-charcoal-ink/70">{t("pharmcollect.intro", locale)}</p>
      </div>
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice === "chosen" || notice === "new_code" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
          {t(`pharmcollect.notice.${notice}`, locale)}
        </p>
      )}
      {!collection.ok || (collection.ok && !collection.data) ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("pharmcollect.load_failed", locale)}</p>
      ) : view === "choose" ? (
        <section className="space-y-3">
          <section className="space-y-2">
            <h3 className="font-semibold text-charcoal-ink">{t("pharmprice.title", locale)}</h3>
            <p className="text-xs text-charcoal-ink/60">{t("pharmprice.intro", locale)}</p>
            {prices?.ok ? <PriceCompare rows={prices.data} locale={locale} /> : <p className="text-sm text-charcoal-ink/70">{t("pharmprice.failed", locale)}</p>}
            <p className="text-sm text-charcoal-ink/70">{t("pharmprice.any_pharmacy", locale)}</p>
          </section>
          <h3 className="font-semibold text-charcoal-ink">{t("pharmcollect.choose", locale)}</h3>
          {pharmacies?.ok ? <Chooser id={prescriptionId} options={pharmacies.data} locale={locale} /> : <p role="alert" className="text-sm text-red-900">{t("pharmcollect.load_failed", locale)}</p>}
        </section>
      ) : view === "code" ? (
        <section className="space-y-4">
          <p className="font-semibold text-charcoal-ink">
            {t("pharmcollect.sent_to", locale, { pharmacy: [collection.data?.pharmacy_name, collection.data?.location_name].filter(Boolean).join(", ") })}
          </p>
          {collection.data?.address && <p className="text-sm text-charcoal-ink/70">{collection.data.address}</p>}
          <p className="text-xs text-charcoal-ink/60">{t("medicines.mas.collect_prompt", locale)} {t("medicines.mas.caveat", locale)}</p>
          <div className="rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
            <p className="text-xs uppercase tracking-wide text-charcoal-ink/60">{t("pharmcollect.code_label", locale)}</p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.3em] text-charcoal-ink" aria-label={t("pharmcollect.code_label", locale)}>
              {collection.data?.code ?? "-"}
            </p>
            <p className="mt-2 text-xs text-charcoal-ink/60">{t("pharmcollect.code_hint", locale)}</p>
            {collection.data?.code_expires_at && <p className="mt-1 text-xs text-charcoal-ink/60">{t("pharmcollect.valid_until", locale, { date: lagos(collection.data.code_expires_at) })}</p>}
          </div>
          {(collection.data?.locked || collection.data?.expired) && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{collection.data.locked ? t("pharmcollect.locked", locale) : t("pharmcollect.expired", locale)}</p>
          )}
          <form action={newCodeAction}>
            <input type="hidden" name="prescription" value={prescriptionId} />
            <button type="submit" className={button}>{t("pharmcollect.new_code", locale)}</button>
          </form>
          <section className="space-y-3 border-t border-charcoal-ink/10 pt-4">
            <h3 className="font-semibold text-charcoal-ink">{t("pharmcollect.change", locale)}</h3>
            <p className="text-xs text-charcoal-ink/60">{t("pharmcollect.change_hint", locale)}</p>
            {pharmacies?.ok && <Chooser id={prescriptionId} options={pharmacies.data} locale={locale} />}
          </section>
        </section>
      ) : view === "collected" ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t("pharmcollect.collected", locale)}</p>
      ) : (
        <p className="text-sm text-charcoal-ink/70">{t("pharmcollect.not_open", locale)}</p>
      )}
    </div>
  );
}
