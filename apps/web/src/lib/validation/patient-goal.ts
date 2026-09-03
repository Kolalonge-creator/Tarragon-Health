import { z } from "zod";

/** Patient Engagement Engine spec §16.10 — personal health goals. goal_type
 * mirrors the small, fixed enum in the patient_goal_type migration; "custom"
 * covers anything else via the free-text description. */
export const PATIENT_GOAL_TYPES = [
  "walk_more",
  "reduce_weight",
  "improve_bp",
  "medication_consistency",
  "complete_screening",
  "stop_smoking",
  "custom",
] as const;

export const createPatientGoalSchema = z.object({
  goal_type: z.enum(PATIENT_GOAL_TYPES),
  description: z.string().trim().min(1).max(300),
  target_value: z.coerce.number().positive().max(1_000_000).optional().or(z.literal("")),
  target_unit: z.string().trim().max(40).optional().or(z.literal("")),
  care_plan_id: z.string().uuid().optional().or(z.literal("")),
});
export type CreatePatientGoalInput = z.infer<typeof createPatientGoalSchema>;

/** §16.11 — daily/periodic progress logging against a goal, one entry per
 * calendar day (the goal_id/logged_date unique constraint backs this). */
export const logGoalProgressSchema = z.object({
  goal_id: z.string().uuid(),
  logged_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  value: z.coerce.number().min(0).max(1_000_000),
});
export type LogGoalProgressInput = z.infer<typeof logGoalProgressSchema>;
