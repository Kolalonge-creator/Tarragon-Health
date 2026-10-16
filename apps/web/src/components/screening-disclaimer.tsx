import { t, type Locale } from "@tarragon/i18n";

/**
 * The standing statement that screening and reports do not rule out disease (S46, function 3.16). One component so the risk result, the screening
 * calendar, the lab results and the yearly report all say exactly the same thing. The wording is a placeholder text key (`disclaimer.screening.standing`)
 * until the Chief Medical Officer approves the final sentence; change the key's value, never a call site.
 */
export function ScreeningDisclaimer({ locale = "en", className = "" }: { locale?: Locale; className?: string }) {
  return (
    <p role="note" className={`text-xs text-charcoal-ink/70 dark:text-night-ink/70 ${className}`.trim()}>
      {t("disclaimer.screening.standing", locale)}
    </p>
  );
}
