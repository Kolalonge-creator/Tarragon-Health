import { z } from "zod";

/** §18.1 foot-risk classification. */
export const FOOT_RISK_CLASSES = ["low", "increased", "high", "active"] as const;
export const FOOT_SENSATIONS = ["normal", "reduced", "absent"] as const;
export const PULSES_OPTIONS = ["yes", "no", "unknown"] as const;

export const footAssessmentSchema = z.object({
  patient_id: z.string().uuid(),
  risk_class: z.enum(FOOT_RISK_CLASSES),
  sensation_left: z.enum(FOOT_SENSATIONS).optional(),
  sensation_right: z.enum(FOOT_SENSATIONS).optional(),
  // tri-state: yes/no map to boolean, unknown → null (not assessed)
  pulses: z.enum(PULSES_OPTIONS).optional(),
  findings: z.string().trim().max(1000).optional(),
});
export type FootAssessmentInput = z.infer<typeof footAssessmentSchema>;

const formBool = z.preprocess(
  (v) => v === true || v === "true" || v === "on" || v === "1",
  z.boolean(),
);

/** §18.2 (eyes) / §18.3 (kidneys) surveillance check. */
export const COMPLICATION_CHECK_TYPES = ["retinal", "renal"] as const;

export const complicationCheckSchema = z.object({
  patient_id: z.string().uuid(),
  check_type: z.enum(COMPLICATION_CHECK_TYPES),
  outcome: z.string().trim().max(500).optional(),
  abnormal: formBool.optional().default(false),
  interval_months: z.coerce.number().int().min(1).max(24).default(12),
});
export type ComplicationCheckInput = z.infer<typeof complicationCheckSchema>;

/** Next foot check due, per risk (§18.1: annual, sooner if higher risk). */
export function footReviewIntervalMonths(risk: (typeof FOOT_RISK_CLASSES)[number]): number {
  switch (risk) {
    case "low":
      return 12;
    case "increased":
      return 12;
    case "high":
      return 6;
    case "active":
      return 1; // active problem is managed via escalation; short safety-net recheck
  }
}
