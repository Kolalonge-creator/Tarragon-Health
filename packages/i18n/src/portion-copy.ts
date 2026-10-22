import { t, type Locale } from "./translate";
import type { MessageKey } from "./en";

/**
 * The words for one portion line of the local food portion guide, shared by the web and the phone so they cannot drift.
 * The NUMBER and the unit come from the versioned configuration (`learning.portion_guide`); only the wording lives here.
 *   { amount: 2, unit: "fist", per: "meal" }  ->  "About 2 fists each meal"
 *   { amount: 0, ... per: "day" }             ->  "Best to leave this out each day"
 */
export interface PortionLine {
  readonly amount: number;
  readonly unit: string;
  readonly per: string;
}

export function portionPhrase(p: PortionLine, locale: Locale = "en"): string {
  const per = t(`learn.portion.per.${p.per}` as MessageKey, locale);
  if (p.amount === 0) return t("learn.portion.skip", locale, { per });
  const unit = t(`learn.portion.unit.${p.unit}.${p.amount === 1 ? "one" : "other"}` as MessageKey, locale);
  return t("learn.portion.amount", locale, { amount: p.amount, unit, per });
}
