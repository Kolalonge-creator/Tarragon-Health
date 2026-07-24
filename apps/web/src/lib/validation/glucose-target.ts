import { z } from "zod";

/** §9 individualised glycaemic target set by a clinician. */
export const GLYCAEMIC_CATEGORIES = ["tight", "standard", "relaxed"] as const;

export const glucoseTargetSchema = z.object({
  patient_id: z.string().uuid(),
  category: z.enum(GLYCAEMIC_CATEGORIES),
  hba1c_target_percent: z.coerce.number().min(5).max(12).optional(),
  fasting_min: z.coerce.number().min(3).max(8).default(4.4),
  fasting_max: z.coerce.number().min(4).max(12).default(7.0),
  upper_target: z.coerce.number().min(6).max(18).default(10.0),
  note: z.string().trim().max(500).optional(),
});
export type GlucoseTargetInput = z.infer<typeof glucoseTargetSchema>;

/** Sensible defaults per category the clinician form pre-fills. */
export const CATEGORY_DEFAULTS: Record<
  (typeof GLYCAEMIC_CATEGORIES)[number],
  { hba1c: number; fastingMax: number; upper: number; label: string }
> = {
  tight: { hba1c: 6.5, fastingMax: 7.0, upper: 8, label: "Tight (< 6.5%) — younger, low hypo risk" },
  standard: { hba1c: 7.0, fastingMax: 7.0, upper: 10, label: "Standard (< 7.0%) — most adults" },
  relaxed: { hba1c: 8.0, fastingMax: 8.5, upper: 12, label: "Relaxed (< 8.0%) — elderly / frail / hypo-prone" },
};
