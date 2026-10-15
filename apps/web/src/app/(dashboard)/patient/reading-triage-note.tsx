import { t } from "@tarragon/i18n";
import { GRADE_KEY, wordingKeys, type PatientTriageRow } from "@/lib/triage/explainer";
import { VITAL_LEVEL_BADGE_CLASSNAME } from "@/lib/rules/vital-level-style";

/**
 * "What happened with this reading": the grade shown at the time (green, amber or red, in plain words) and the approved
 * guidance for it, folded away so the history stays short. It names no condition. It is in-app only; no notification
 * carries it (INV-07). Nothing here is shown for a reading with no result, or whose result came from an unapproved rule set.
 */
export function ReadingTriageNote({ result }: { result: PatientTriageRow | undefined }) {
  if (!result) return null;
  const words = wordingKeys(result.explanation_key);
  return (
    <details className="mt-1 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
      <summary className="cursor-pointer select-none">
        <span className="font-medium">{t("triage.history.title")}</span>
        <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${VITAL_LEVEL_BADGE_CLASSNAME[result.grade]}`}>
          {t(GRADE_KEY[result.grade])}
        </span>
      </summary>
      <div className="mt-1 space-y-1">
        <p className="text-[11px] uppercase tracking-wide">{t("triage.history.shown")}</p>
        {words && (
          <>
            <p className="font-medium text-charcoal-ink dark:text-night-ink">{t(words.title)}</p>
            <p>{t(words.body)}</p>
          </>
        )}
        <p className="italic">{t("triage.history.note")}</p>
      </div>
    </details>
  );
}
