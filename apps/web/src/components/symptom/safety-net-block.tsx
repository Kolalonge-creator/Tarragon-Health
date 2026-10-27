import { buildSafetyNet, safetyNetLines, type SafetyNetConfig, type TriageCategory } from "@tarragon/symptom-triage-engine";
import { t } from "@tarragon/i18n";
import { tr } from "@/lib/symptom-triage/tr";

/**
 * S59c: "Go to a hospital or call for help straight away if ...". The GENERIC lines are always shown (they come from the string
 * catalogue and need no config). The pathway's own lines are added only when the safety-net config is signed and matches the live one
 * (the parent resolves that; an unsigned or drifted config arrives here as null and only the generic block shows). The national
 * emergency number appears only when that config is signed AND the number is marked confirmed. Plain markup, no state, works offline.
 */
export function SafetyNetBlock({ pathwayKey, category, config }: { pathwayKey: string; category: TriageCategory; config: SafetyNetConfig | null }) {
  const net = buildSafetyNet({ pathwayKey, category }, config);
  const { lines, closing } = safetyNetLines(net, tr);
  return (
    <section aria-labelledby="symptom-safety-title" data-testid="safety-net" className="space-y-1.5 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <h3 id="symptom-safety-title" className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
        {t("symptom.net.title")}
      </h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-charcoal-ink dark:text-night-ink">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {closing.map((c) => (
        <p key={c} className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          {c}
        </p>
      ))}
    </section>
  );
}
