import Link from "next/link";
import { en, t, type Locale } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { isMessageKey, type CatalogueItem } from "@/lib/commerce/model";

/** Catalogue copy keys come from the database. A key this build does not know shows nothing, never the raw key. */
function copy(key: string, locale: Locale): string {
  return isMessageKey(key, en) ? t(key, locale) : "";
}

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * "What is included" for one catalogue item (module 20.6): what you get, what it costs, how it ends, how to ask for a refund, in short
 * sentences. It carries no personal detail beyond the price the signed-in person would pay, so its address is safe to pass on. The price
 * comes from the same database quote as checkout (S73), so this page and the charge cannot disagree.
 */
export function IncludedView({ item, yourPriceKobo, locale }: { item: CatalogueItem | null; yourPriceKobo: number | null; locale: Locale }) {
  if (!item) {
    return (
      <div className="space-y-3">
        <p role="status">{t("included.unavailable", locale)}</p>
        <p><Link href="/patient/membership" className="underline">{t("included.back", locale)}</Link></p>
      </div>
    );
  }
  const yours = yourPriceKobo !== null && yourPriceKobo !== item.amount_kobo ? yourPriceKobo : null;
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h2 className="font-heading text-xl font-semibold">{copy(item.name_key, locale)}</h2>
        <p>{copy(item.description_key, locale)}</p>
      </header>
      <section aria-labelledby="included-list" className="space-y-2">
        <h3 id="included-list" className="font-medium">{t("included.title", locale)}</h3>
        <ul className="list-disc space-y-1 pl-5">
          {item.included_keys.map((k) => (copy(k, locale) ? <li key={k}>{copy(k, locale)}</li> : null))}
        </ul>
      </section>
      <section aria-labelledby="included-price" className="space-y-2">
        <h3 id="included-price" className="font-medium">{t("included.price_heading", locale)}</h3>
        <dl className="space-y-1">
          <div className="flex justify-between"><dt>{t(yours === null ? "pay.fee.price" : "included.list_price", locale)}</dt><dd>{"₦"}{formatNaira(item.amount_kobo)}</dd></div>
          {yours !== null ? <div className="flex justify-between font-semibold"><dt>{t("included.your_price", locale)}</dt><dd>{"₦"}{formatNaira(yours)}</dd></div> : null}
        </dl>
        <p className={`text-sm ${MUTED}`}>{t("pay.fee.explain", locale)}</p>
      </section>
      <section className="space-y-2">
        {item.duration_days ? <p>{t("included.how_long", locale, { days: String(item.duration_days) })}</p> : null}
        {item.uses ? <p>{t("included.uses", locale, { uses: String(item.uses) })}</p> : null}
        <p>{t("included.no_renew", locale)}</p>
        <p>{t("included.refund", locale)}</p>
      </section>
      <p><Link href="/patient/membership" className="inline-flex min-h-11 items-center underline">{t("included.buy", locale)}</Link></p>
    </article>
  );
}
