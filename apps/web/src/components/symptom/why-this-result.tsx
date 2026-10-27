import type { Explanation } from "@tarragon/symptom-triage-engine";
import { explainerFactText } from "@tarragon/symptom-triage-engine";
import { t } from "@tarragon/i18n";
import { tr } from "@/lib/symptom-triage/tr";
import { symptomOptionLabel } from "@/lib/symptom-triage/option-label";

/**
 * S59c: "Why this result". Renders an explanation only if there is one: the engine returns null unless the explainer config is signed and
 * has text for a rule that fired in THIS result, and then this component is not rendered at all (the parent checks). It shows reasons and
 * the person's own answers, "tell your care team sooner if" lines, and nothing else: no ranking, no causes, no diagnosis. The shared
 * "not a diagnosis" label is rendered by the result screen that contains this section.
 */
export function WhyThisResult({ explanation }: { explanation: Explanation }) {
  return (
    <section aria-labelledby="symptom-why-title" data-testid="why-this-result" className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <h3 id="symptom-why-title" className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
        {t("symptom.why.title")}
      </h3>
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.why.intro")}</p>
      {explanation.items.map((item) => (
        <div key={item.id} className="space-y-1">
          <p className="text-sm text-charcoal-ink dark:text-night-ink">{item.reason}</p>
          {item.youTold.length > 0 && (
            <div>
              <p className="text-xs font-medium text-charcoal-ink/80 dark:text-night-ink/80">{t("symptom.why.you_told")}</p>
              <ul className="list-disc pl-5 text-xs text-charcoal-ink/80 dark:text-night-ink/80">
                {item.youTold.map((f, i) => (
                  <li key={i}>{explainerFactText(f, tr, symptomOptionLabel)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
      {explanation.tellUsSooner.length > 0 && (
        <div>
          <p className="text-xs font-medium text-charcoal-ink/80 dark:text-night-ink/80">{t("symptom.why.sooner")}</p>
          <ul className="list-disc pl-5 text-xs text-charcoal-ink/80 dark:text-night-ink/80">
            {explanation.tellUsSooner.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
