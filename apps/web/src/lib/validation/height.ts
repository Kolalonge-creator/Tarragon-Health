import { z } from "zod";

// Same bounds as riskAssessmentSchema's height_cm in risk-assessment.ts —
// profiles.height_cm is the same patient-self-reported quantity, reconciled
// against that questionnaire answer (lib/health-metrics/height.ts).
export const heightSchema = z.object({
  height_cm: z.coerce
    .number()
    .min(100, "Height must be at least 100 cm")
    .max(230, "Height must be at most 230 cm"),
});

export type HeightInput = z.infer<typeof heightSchema>;
