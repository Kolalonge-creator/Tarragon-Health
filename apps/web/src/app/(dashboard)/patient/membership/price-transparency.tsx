import { en, t, type Locale } from "@tarragon/i18n";
import { formatNaira, monthlyEquivalentKobo, type NotIncludedEntry, type PriceChangeNotice } from "@tarragon/commerce";
import { formatPatientDate } from "@/lib/format-date";
import { isMessageKey } from "@/lib/commerce/model";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const naira = (kobo: number) => `₦${formatNaira(kobo)}`;

/** Catalogue copy keys come from the database. A key this build does not know shows nothing, never the raw key. */
function copy(key: string, locale: Locale): string {
  return isMessageKey(key, en) ? t(key, locale) : "";
}

/**
 * What an item does not include (competitor gap B1). A priced extra shows the price the database gives for it today; an extra with no live
 * price shows "Ask us", never a number made up here. Words-only entries (for example medicines) carry no price at all.
 */
export function NotIncludedList({ entries, locale, id }: { entries: readonly NotIncludedEntry[]; locale: Locale; id: string }) {
  const shown = entries.filter((e) => copy(e.labelKey, locale) !== "");
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby={`notincl-${id}`} className="space-y-2">
      <h3 id={`notincl-${id}`} className="font-medium">{t("notincl.title", locale)}</h3>
      <ul className="list-disc space-y-1 pl-5">
        {shown.map((e) => {
          const name = copy(e.labelKey, locale);
          if (e.extraCode === null) return <li key={e.labelKey}>{name}</li>;
          return (
            <li key={e.labelKey} className="flex justify-between gap-3">
              <span>{name}</span>
              {e.amountKobo !== null ? <span>{naira(e.amountKobo)}</span> : <span aria-label={t("notincl.ask_us_label", locale, { name })}>{t("notincl.ask_us", locale)}</span>}
            </li>
          );
        })}
      </ul>
      {shown.some((e) => e.extraCode !== null) ? <p className={`text-sm ${MUTED}`}>{t("notincl.sold_separately", locale)}</p> : null}
    </section>
  );
}

/**
 * "About N a month. Billed once a year, not monthly." (competitor gap B3). A way to compare a yearly price, never a payment plan: the
 * sentence is one string so the monthly figure can never appear without the plain statement beside it. Nothing is shown for Free, a
 * covered price, or an item that is not a year long.
 */
export function MonthlyEquivalent({ amountDueKobo, durationDays, locale }: { amountDueKobo: number; durationDays: number | null; locale: Locale }) {
  const monthly = monthlyEquivalentKobo(amountDueKobo, durationDays);
  if (monthly === null) return null;
  return <p className={`text-sm ${MUTED}`}>{t("price.monthly_equivalent", locale, { amount: naira(monthly) })}</p>;
}

/** A price is changing for something the person already holds (competitor gap B2). Calm, plain, and clear that nothing is charged. */
export function PriceChangeCard({ notices, locale }: { notices: readonly PriceChangeNotice[]; locale: Locale }) {
  if (notices.length === 0) return null;
  return (
    <section aria-labelledby="price-change-title" className="space-y-3 rounded-lg border p-4" role="region">
      <h2 id="price-change-title" className="font-heading text-lg font-semibold">{t("pricechange.title", locale)}</h2>
      {notices.map((n) => (
        <div key={`${n.itemCode}-${n.endsAt}`} className="space-y-1">
          <p>{t("pricechange.body", locale, { name: copy(n.nameKey, locale), paid: naira(n.paidListKobo), date: formatPatientDate(n.newFrom), price: naira(n.newKobo) })}</p>
          <p>{t("pricechange.kept", locale, { ends: formatPatientDate(n.endsAt) })}</p>
        </div>
      ))}
      <p className={MUTED}>{t("pricechange.renew", locale)}</p>
    </section>
  );
}
