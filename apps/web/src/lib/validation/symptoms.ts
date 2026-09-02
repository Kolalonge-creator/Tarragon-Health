import { z } from "zod";

export const SYMPTOM_TYPES = [
  "pain",
  "fatigue",
  "breathlessness",
  "dizziness",
  "palpitations",
  "swelling",
  "nausea",
  "chest_pain",
  "severe_headache",
  "visual_disturbance",
  "confusion",
  // Paediatric danger signs with no honest adult-symptom equivalent — see
  // lib/rules/pediatric-symptom-triage.ts, which only offers these when
  // logging for a dependent under 5 (shouldOfferPaediatricSymptomTypes) and
  // applies a lower escalation bar to them for that age group.
  "poor_feeding",
  "lethargy",
  "grunting_or_retractions",
  "dehydration_signs",
  "other",
] as const;

export const symptomLogSchema = z.object({
  symptom_type: z.enum(SYMPTOM_TYPES),
  severity: z.coerce.number().int().min(1, "Severity must be at least 1").max(10, "Severity must be at most 10"),
  description: z.string().trim().max(500).optional(),
  /** Medication safety pathway 64.9: set when reported as "I'm experiencing a side effect" against a specific medication. */
  medication_id: z.string().uuid().optional(),
});
export type SymptomLogInput = z.infer<typeof symptomLogSchema>;
