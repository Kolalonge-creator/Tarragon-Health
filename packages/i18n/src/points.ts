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

/** The card text for a milestone code. An unknown (newly added) code reads as a generic thank-you, never a raw key. */
export function milestoneCopy(code: string, locale: Locale = DEFAULT_LOCALE): { title: string; body: string } {
  const titleKey = `points.milestone.${code}.title`;
  const bodyKey = `points.milestone.${code}.body`;
  if (titleKey in en && bodyKey in en) {
    return { title: t(titleKey as MessageKey, locale), body: t(bodyKey as MessageKey, locale) };
  }
  return { title: t("points.milestone.generic.title", locale), body: t("points.milestone.generic.body", locale) };
}

/** The patient-facing name of the care step a pending action belongs to (its first rule code). */
export function pendingActionLabel(ruleCodes: readonly string[], locale: Locale = DEFAULT_LOCALE): string {
  const first = ruleCodes[0];
  return first ? pointsRuleLabel(first, locale) : pointsRuleLabel("", locale);
}
