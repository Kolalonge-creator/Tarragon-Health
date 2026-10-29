import { z } from "zod";

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false")])
  .nullish()
  .transform((v) => v === "on" || v === "true");

/** The pre-exercise readiness screen (spec §18.6, PAR-Q-style). Every "yes"
 * here is a reason a clinician should look before this patient starts
 * anything more than a beginner programme — never auto-cleared. An
 * unchecked HTML checkbox is simply absent from FormData, so every field
 * has to tolerate a missing key, not just an empty string. */
export const exerciseReadinessScreenSchema = z.object({
  chest_pain: checkbox,
  dizziness_or_balance: checkbox,
  joint_bone_problem: checkbox,
  doctor_advised_limit: checkbox,
  heart_or_bp_condition: checkbox,
  other_concern: z.string().trim().max(300).nullish(),
});
export type ExerciseReadinessScreenInput = z.infer<typeof exerciseReadinessScreenSchema>;

export const READINESS_QUESTIONS: { name: keyof ExerciseReadinessScreenInput; label: string }[] = [
  { name: "chest_pain", label: "Do you ever feel chest pain during physical activity?" },
  { name: "dizziness_or_balance", label: "Do you feel dizzy or lose your balance during activity?" },
  { name: "joint_bone_problem", label: "Do you have a joint or bone problem that could worsen with exercise?" },
  { name: "doctor_advised_limit", label: "Has a doctor ever told you to limit your physical activity?" },
  { name: "heart_or_bp_condition", label: "Do you have a heart condition or blood pressure that isn't well controlled?" },
];

export const enrollExerciseProgrammeSchema = z.object({
  programme_id: z.string().uuid(),
});
export type EnrollExerciseProgrammeInput = z.infer<typeof enrollExerciseProgrammeSchema>;

export const EXERCISE_KINDS = ["walking", "mobility", "strength", "cardio", "other"] as const;
export const EXERCISE_KIND_LABELS: Record<(typeof EXERCISE_KINDS)[number], string> = {
  walking: "Walking",
  mobility: "Stretching & mobility",
  strength: "Strength",
  cardio: "Cardio",
  other: "Something else",
};
export const EXERCISE_EFFORTS = ["easy", "moderate", "hard"] as const;
export const EXERCISE_EFFORT_LABELS: Record<(typeof EXERCISE_EFFORTS)[number], string> = {
  easy: "Easy",
  moderate: "Steady",
  hard: "Hard",
};

/** A blank optional field posts "": treat it as not given rather than as an invalid value. */
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/**
 * One session done. The date window (not future, at most 30 days back) and "that programme is yours" are enforced by the database trigger
 * private.exercise_session_log_guard; this schema only shapes the input.
 */
export const logExerciseSessionSchema = z.object({
  performed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day you exercised"),
  duration_minutes: z.coerce.number().int("Minutes must be a whole number").min(1, "Enter at least 1 minute").max(600, "That is more than 10 hours, please check"),
  kind: z.enum(EXERCISE_KINDS),
  effort: z.preprocess(blankToUndefined, z.enum(EXERCISE_EFFORTS).optional()),
  symptom_during: checkbox,
  enrollment_id: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  note: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()),
});
export type LogExerciseSessionInput = z.infer<typeof logExerciseSessionSchema>;

export const deleteExerciseSessionSchema = z.object({ id: z.string().uuid() });
