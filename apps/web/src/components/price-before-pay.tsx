import { t } from "@tarragon/i18n";
import { formatNairaForPatient } from "@/lib/format-money";

/**
 * Design principle 4 (the naira price shows before commitment). Put this directly above a pay / buy / confirm button so the price is
 * on screen before the tap that commits. Takes the amount in KOBO straight from the pricing source (`service_products`,
 * `lab_tests`, an order total, ...); it never recomputes a price. `0` reads "No charge". A missing price renders nothing, because a
 * guessed price is worse than none: the caller should keep the commit button disabled in that case.
 */
export function PriceBeforePay({ kobo, className = "" }: { kobo: number | null | undefined; className?: string }) {
  // An unknown or invalid amount (null, NaN, negative, fractional kobo) renders nothing rather than throwing or guessing a price.
  if (kobo == null || !Number.isInteger(kobo) || kobo < 0) return null;
  const text = kobo === 0 ? t("dp.price.no_charge") : t("dp.price.you_pay", "en", { amount: formatNairaForPatient(kobo) });
  return (
    <p className={`text-sm font-semibold text-charcoal-ink dark:text-night-ink ${className}`} data-testid="price-before-pay">
      {text}
    </p>
  );
}
