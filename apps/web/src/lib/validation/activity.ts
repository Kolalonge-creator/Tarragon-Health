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
  "Swimming",
  "Cycling",
  "Strength Training",
  "Yoga",
  "Other",
] as const;

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

export const logWorkoutSchema = z.object({
  activity_name: z.string().trim().min(1).max(80),
  duration_minutes: z.coerce.number().int().positive().max(1000),
  note: z.string().trim().max(300).nullish(),
});
export type LogWorkoutInput = z.infer<typeof logWorkoutSchema>;
