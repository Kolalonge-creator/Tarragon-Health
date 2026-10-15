"use client";

import { t, type Locale } from "@tarragon/i18n";
import type { SafetyLine } from "@/lib/scribe/safety-lines";

/**
 * S64 (15.4): the allergy and medicine lines of an AI scribe draft, shown before the rest of the sign-off view, with one explicit
 * confirmation. Signing an AI-drafted note is refused by the database until this has been confirmed (and any later edit clears it), so
 * this panel is where a clinician is stopped from skimming past the lines the audits found most often wrong.
 */
export function SafetyLinesPanel({
  lines,
  confirmed,
  onConfirmedChange,
  locale = "en",
}: {
  lines: readonly SafetyLine[];
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  locale?: Locale;
}) {
  return (
    <section className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10" aria-label={t("scribe.safety.title", locale)}>
      <h3 className="font-medium">{t("scribe.safety.title", locale)}</h3>
      {lines.length === 0 ? (
        <p>{t("scribe.safety.none", locale)}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5">
          {lines.map((l, i) => (
            <li key={`${l.section}-${i}`} data-kind={l.kind}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} className="mt-0.5" />
        <span>{t("scribe.safety.confirm", locale)}</span>
      </label>
      {!confirmed && <p role="status" className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("scribe.safety.required", locale)}</p>}
    </section>
  );
}
