import { en, type MessageKey } from "./en";
import { t, type Locale, DEFAULT_LOCALE } from "./index";

/** The patient-facing label for a ledger reason or rule code. Unknown codes read as plain words, never a raw key. */
export function pointsRuleLabel(reason: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `points.rule.${reason}`;
  return key in en ? t(key as MessageKey, locale) : reason.replace(/_/g, " ");
}

/** The level name for a tier key from `my_points_status`. */
export function pointsTierLabel(tier: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `points.tier.${tier}`;
  return key in en ? t(key as MessageKey, locale) : tier;
}
