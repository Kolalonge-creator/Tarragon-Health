/**
 * Workout plan display rules (S48b, spec 5.3 / 5.4). PURE. The activity safety gate (database, `my_workout_plans()`) decides WHICH plans a person may
 * see; this only decides the ORDER and the audio slot wording, never what is allowed.
 *
 * Numbers come from the PROPOSED config `activity.workout_plans` (older_adult_age; session_minutes mirrors the database CHECK).
 */
export interface WorkoutPlanLike {
  readonly code: string;
  readonly format: "home" | "chair_class";
  readonly sessions: readonly { readonly minutes: number }[];
  readonly audio_clip_ids?: readonly string[];
}

export interface WorkoutPlanDisplayConfig {
  readonly session_minutes: { readonly min: number; readonly max: number };
  readonly older_adult_age: number;
}

/** From the older-adult age a chair-based class is listed first. Unknown age keeps the natural order. Never reorders within a format. */
export function orderPlans<P extends WorkoutPlanLike>(plans: readonly P[], ageYears: number | null, cfg: WorkoutPlanDisplayConfig): P[] {
  if (ageYears === null || ageYears < cfg.older_adult_age) return [...plans];
  return [...plans.filter((p) => p.format === "chair_class"), ...plans.filter((p) => p.format !== "chair_class")];
}

/** True when every session is inside the 10 to 20 minute range (the same rule the database enforces). */
export function sessionsWithinRange(plan: WorkoutPlanLike, cfg: WorkoutPlanDisplayConfig): boolean {
  return plan.sessions.every((s) => s.minutes >= cfg.session_minutes.min && s.minutes <= cfg.session_minutes.max);
}

/**
 * Audio is a DRAFT slot: a plan names clip ids only after a recording exists and is clinician-reviewed (database CHECK). A screen never shows a
 * play control from the id alone; it shows one only when the clip is actually playable in the downloaded audio bundle. Text steps are always shown.
 */
export function planHasAudioSlot(plan: WorkoutPlanLike): boolean {
  return (plan.audio_clip_ids?.length ?? 0) > 0;
}
