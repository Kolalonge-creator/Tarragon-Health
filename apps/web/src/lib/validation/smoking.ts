import { z } from "zod";
import type { Enums } from "@tarragon/shared";

/** Mirrors public.smoking_status. */
export const SMOKING_STATUSES = ["never", "former", "current"] as const;
const _smokingStatusCheck: readonly Enums<"smoking_status">[] = SMOKING_STATUSES;
void _smokingStatusCheck;

export const SMOKING_STATUS_LABELS: Record<(typeof SMOKING_STATUSES)[number], string> = {
  never: "Never smoked",
  former: "Former smoker",
  current: "Current smoker",
};

/** Mirrors public.smoking_trigger. */
export const SMOKING_TRIGGERS = [
  "stress",
  "social",
  "alcohol",
  "after_meals",
  "boredom",
  "habit",
  "craving",
  "other",
] as const;
const _smokingTriggerCheck: readonly Enums<"smoking_trigger">[] = SMOKING_TRIGGERS;
void _smokingTriggerCheck;

export const SMOKING_TRIGGER_LABELS: Record<(typeof SMOKING_TRIGGERS)[number], string> = {
  stress: "Stress",
  social: "Social situations",
  alcohol: "Drinking alcohol",
  after_meals: "After meals",
  boredom: "Boredom",
  habit: "Habit or routine",
  craving: "A craving",
  other: "Something else",
};

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date");

export const setSmokingProfileSchema = z
  .object({
    status: z.enum(SMOKING_STATUSES),
    cigarettes_per_day: z.coerce.number().int().min(0).max(200).nullish(),
    years_smoking: z.coerce.number().min(0).max(100).nullish(),
    quit_motivation: z.coerce.number().int().min(0).max(10).nullish(),
    quit_date: dateOnly.nullish(),
  })
  .transform((v) => ({
    ...v,
    // Only a current smoker carries a cigarettes/day figure — matches the
    // DB's patient_smoking_profiles_cigs_only_if_current check constraint.
    cigarettes_per_day: v.status === "current" ? (v.cigarettes_per_day ?? null) : null,
  }));
export type SetSmokingProfileInput = z.infer<typeof setSmokingProfileSchema>;

export const logSmokingCheckInSchema = z.object({
  cigarettes_smoked: z.coerce.number().int().min(0).max(200),
  cravings_intensity: z.coerce.number().int().min(0).max(10).nullish(),
  triggers: z.array(z.enum(SMOKING_TRIGGERS)).max(SMOKING_TRIGGERS.length).default([]),
  note: z.string().trim().max(300).nullish(),
});
export type LogSmokingCheckInInput = z.infer<typeof logSmokingCheckInSchema>;
