"use client";

import { t } from "@tarragon/i18n";
import { NAFDAC_GREENBOOK_URL, NAFDAC_VERIFY_STEP_KEYS } from "@tarragon/medicines";

/**
 * How to check a NAFDAC number with NAFDAC itself (S08y). Plain steps and a link. Tarragon does not check the number, sends no
 * text message and says nothing about whether a pack is genuine; the card says so first. Sources: docs/research/S08y.md.
 */
export function NafdacVerifyCard({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-2 rounded-md border border-charcoal-ink/15 p-3 text-sm text-charcoal-ink dark:border-night-ink/20 dark:text-night-ink ${className}`}>
      <p className="font-medium">{t("medicines.nafdac.verify.title")}</p>
      <p className="text-charcoal-ink/70 dark:text-night-ink/70">{t("medicines.nafdac.verify.not_a_check")}</p>
      <ol className="list-decimal space-y-1 pl-5">
        {NAFDAC_VERIFY_STEP_KEYS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <a
        href={NAFDAC_GREENBOOK_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center font-medium text-brand-green underline dark:text-brand-green-bright"
      >
        {t("medicines.nafdac.verify.open_greenbook")}
      </a>
    </div>
  );
}

/** The saved number beside a medicine, with the how-to folded away until asked for. */
export function NafdacNote({ number }: { number: string }) {
  return (
    <details className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
      <summary className="min-h-11 cursor-pointer py-2">{t("medicines.nafdac.shown", undefined, { number })}</summary>
      <NafdacVerifyCard className="mt-1" />
    </details>
  );
}
