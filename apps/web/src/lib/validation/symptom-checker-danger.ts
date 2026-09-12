import { z } from "zod";
import { DANGER_SYMPTOM_IDS, SYMPTOM_OPTIONS } from "@/lib/symptom-check/symptom-clusters";

/**
 * Validation for escalating a danger-symptom selection made inside the
 * patient dashboard's Symptom-to-Test checker (symptom-to-test-check.tsx)
 * into a real emergency_events row. Same shape as DANGER_SIGNS/
 * dangerReportSchema in emergency.ts, PAEDIATRIC_DANGER_SIGNS in
 * pediatric-emergency.ts, and PREGNANCY_DANGER_SIGNS in womens-health.ts —
 * just scoped to the checker's own symptom vocabulary (DANGER_SYMPTOM_IDS,
 * lib/symptom-check/symptom-clusters.ts) rather than inventing a second list
 * of the same red flags.
 */
export const symptomCheckerDangerReportSchema = z.object({
  signs: z.array(z.enum(DANGER_SYMPTOM_IDS)).min(1, "Select at least one sign"),
});

export type SymptomCheckerDangerSign = (typeof DANGER_SYMPTOM_IDS)[number];

const SYMPTOM_LABEL_BY_ID = new Map(SYMPTOM_OPTIONS.map((option) => [option.id, option.label]));

/** Human-readable summary stored on emergency_events.trigger_detail. */
export function symptomCheckerDangerSignsSummary(signs: SymptomCheckerDangerSign[]): string {
  return signs.map((id) => SYMPTOM_LABEL_BY_ID.get(id) ?? id).join(", ");
}
