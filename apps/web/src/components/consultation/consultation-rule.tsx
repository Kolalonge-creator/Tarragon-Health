"use client";

import { t, type Locale } from "@tarragon/i18n";
import { koboToNaira } from "@tarragon/shared";
import { useMyConsultationRule } from "@/lib/queries/appointments";

/**
 * S21 (OQ-127, OQ-129, OQ-130): the price, the cancel rule and the age rule, shown BEFORE the patient pays. Every number
 * comes from the live consultation policy and the live price, never from this file, so a change in config changes this
 * screen. Renders nothing until the rule has loaded, rather than showing a guess.
 */
export function ConsultationRuleCard({ locale = "en" }: { locale?: Locale }) {
  const { data: rule } = useMyConsultationRule();
  if (!rule) return null;
  const price = rule.price_kobo === null ? null : `₦${koboToNaira(rule.price_kobo).toLocaleString("en-NG")}`;
  return (
    <div className="space-y-1 rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15">
      <p className="font-medium">{t("consult.rule.title", locale)}</p>
      {price && <p>{t("consult.rule.price", locale, { price })}</p>}
      <p>{t("consult.rule.cancel", locale, { hours: rule.cancel_window_hours })}</p>
      {!rule.late_cancel_credit_returned && <p>{t("consult.rule.late", locale)}</p>}
      <p>{t("consult.rule.care_team_cancels", locale)}</p>
      <p>{t("consult.rule.adult", locale, { age: rule.min_age_years })}</p>
    </div>
  );
}
