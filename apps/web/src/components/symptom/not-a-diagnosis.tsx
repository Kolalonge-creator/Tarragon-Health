import { t } from "@tarragon/i18n";

/**
 * The one "not a diagnosis" label (S60, spec 12.9). Every symptom checker surface that shows a result, a review or a list of
 * possible causes renders THIS component; the words live in packages/i18n (`symptom.not_a_diagnosis.*`), never in a screen.
 * `not-a-diagnosis.test.ts` fails if a symptom result screen stops using it or hard-codes the sentence.
 *
 * It is plain markup with no state, so it works in a server or a client component and offline.
 */
export function NotADiagnosis({ variant = "full", className = "" }: { variant?: "full" | "short"; className?: string }) {
  return (
    <p
      role="note"
      data-testid="not-a-diagnosis"
      className={`rounded-lg bg-charcoal-ink/5 px-3 py-2 text-xs text-charcoal-ink/80 dark:bg-night-ink/10 dark:text-night-ink/80 ${className}`.trim()}
    >
      {t(variant === "short" ? "symptom.not_a_diagnosis.short" : "symptom.not_a_diagnosis.full")}
    </p>
  );
}
