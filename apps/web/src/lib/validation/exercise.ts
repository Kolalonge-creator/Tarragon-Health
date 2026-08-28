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
