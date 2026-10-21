import { z } from "zod";
import type { Enums } from "@tarragon/shared";

/** Activity entry types — mirror the DB enum public.activity_entry_type. */
export const ACTIVITY_ENTRY_TYPES = ["steps", "workout"] as const;
const _activityTypeCheck: readonly Enums<"activity_entry_type">[] = ACTIVITY_ENTRY_TYPES;
void _activityTypeCheck;

/** A short, common set of workout names — free text is still accepted (the
 * DB column is a plain text, not an enum), this just seeds the picker. */
export const COMMON_ACTIVITY_NAMES = [
  "Indoor Walk",
  "Outdoor Walk",
  "Run",
  "Dancing",
  "Football",
  "Farm or manual work",
  "Chair-based exercise",
  "Swimming",
  "Cycling",
  "Strength Training",
  "Yoga",
  "Other",
] as const;

/** Activity kinds - mirror the DB enum public.activity_kind (S48a, spec 5.2). */
export const ACTIVITY_KINDS = ["walking", "running", "cycling", "dancing", "football", "farm_manual_work", "chair_based"] as const;
const _activityKindCheck: readonly Enums<"activity_kind">[] = ACTIVITY_KINDS;
void _activityKindCheck;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** The picker's names that map onto a kind. A name with no entry here (Swimming, Yoga, Other) is logged without a kind, as before. */
export const KIND_BY_ACTIVITY_NAME: Partial<Record<(typeof COMMON_ACTIVITY_NAMES)[number], ActivityKind>> = {
  "Indoor Walk": "walking",
  "Outdoor Walk": "walking",
  Run: "running",
  Dancing: "dancing",
  Football: "football",
  "Farm or manual work": "farm_manual_work",
  "Chair-based exercise": "chair_based",
  Cycling: "cycling",
};

export const setActivityGoalSchema = z.object({
  daily_step_goal: z.coerce.number().int().positive().max(100000),
});
export type SetActivityGoalInput = z.infer<typeof setActivityGoalSchema>;

/** Logging today's step count. The day itself is derived server-side
 * (Africa/Lagos "today"), never taken from the client — one row per patient
 * per day, upserted, matching the DB's partial unique index. */
export const logStepsSchema = z.object({
  step_count: z.coerce.number().int().min(0).max(200000),
});
export type LogStepsInput = z.infer<typeof logStepsSchema>;

/** The weekly active-minutes goal; the bound is the minutes in a week (the DB check), not a clinical figure. */
export const setWeeklyGoalSchema = z.object({
  weekly_active_minutes_goal: z.coerce.number().int().min(1).max(10080),
});

export const logWorkoutSchema = z.object({
  activity_name: z.string().trim().min(1).max(80),
  duration_minutes: z.coerce.number().int().positive().max(1000),
  /** Optional distance in kilometres; stored as whole metres. */
  distance_km: z.coerce.number().min(0).max(1000).optional(),
  note: z.string().trim().max(300).nullish(),
});
export type LogWorkoutInput = z.infer<typeof logWorkoutSchema>;
