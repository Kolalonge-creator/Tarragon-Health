import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";
import { parseActivityGate, unavailableActivityGate, type ActivityGateResult } from "@tarragon/clinical/activity-gate";

export type ExerciseProgramme = Tables<"exercise_programmes">;
export type ExerciseReadinessScreen = Tables<"exercise_readiness_screens">;
export type ExerciseEnrollment = Tables<"patient_exercise_enrollments"> & { programme: ExerciseProgramme | null };

export const READINESS_QUESTIONS: { name: keyof ReadinessAnswers; label: string }[] = [
  { name: "chest_pain", label: "Do you ever feel chest pain during physical activity?" },
  { name: "dizziness_or_balance", label: "Do you feel dizzy or lose your balance during activity?" },
  { name: "joint_bone_problem", label: "Do you have a joint or bone problem that could worsen with exercise?" },
  { name: "doctor_advised_limit", label: "Has a doctor ever told you to limit your physical activity?" },
  { name: "heart_or_bp_condition", label: "Do you have a heart condition or blood pressure that isn't well controlled?" },
];

export interface ReadinessAnswers {
  chest_pain: boolean;
  dizziness_or_balance: boolean;
  joint_bone_problem: boolean;
  doctor_advised_limit: boolean;
  heart_or_bp_condition: boolean;
  other_concern: string;
}

/** Mirrors apps/web/src/lib/queries/exercise.ts's clearsForModerate --
 * read-only UI hint, private.enforce_exercise_readiness() is the real gate. */
export function clearsForModerate(screen: ExerciseReadinessScreen | null): boolean {
  if (!screen) return false;
  return !screen.any_flag || screen.cleared_for_intensive;
}

/** A vigorous programme always needs explicit clinician clearance. */
export function clearsForVigorous(screen: ExerciseReadinessScreen | null): boolean {
  return !!screen?.cleared_for_intensive;
}

export async function loadExerciseProgrammes(): Promise<QueryResult<ExerciseProgramme[]>> {
  const { data, error } = await supabase.from("exercise_programmes").select("*").eq("is_active", true).order("category");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

export async function loadLatestReadinessScreen(patientId: string): Promise<QueryResult<ExerciseReadinessScreen | null>> {
  const { data, error } = await supabase
    .from("exercise_readiness_screens")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

export async function loadExerciseEnrollments(patientId: string): Promise<QueryResult<ExerciseEnrollment[]>> {
  const { data, error } = await supabase
    .from("patient_exercise_enrollments")
    .select("*, programme:exercise_programmes(*)")
    .eq("patient_id", patientId)
    .order("started_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as ExerciseEnrollment[] };
}

/** Same shape as web's submitReadinessScreenAction -- a plain RLS-scoped
 * insert, no service-role route needed (unlike the mental-health check-in,
 * nothing here computes a safety flag client-side that a malicious client
 * could spoof; private.enforce_exercise_readiness is the DB-side gate and
 * is re-checked on every enrollment attempt regardless). */
export async function submitReadinessScreen(
  patientId: string,
  organisationId: string,
  answers: ReadinessAnswers
): Promise<{ error?: string }> {
  const { error } = await supabase.from("exercise_readiness_screens").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    chest_pain: answers.chest_pain,
    dizziness_or_balance: answers.dizziness_or_balance,
    joint_bone_problem: answers.joint_bone_problem,
    doctor_advised_limit: answers.doctor_advised_limit,
    heart_or_bp_condition: answers.heart_or_bp_condition,
    other_concern: answers.other_concern || null,
  });
  return error ? { error: error.message } : {};
}

/** private.enforce_exercise_readiness is the real safety gate -- it raises
 * a plain Postgres exception with a patient-readable message when a
 * moderate/vigorous programme needs a screen or clearance that doesn't
 * exist yet, which surfaces here as error.message. Never re-implemented
 * client-side. */
export async function enrollExerciseProgramme(
  patientId: string,
  organisationId: string,
  programmeId: string
): Promise<{ error?: string }> {
  const { error } = await supabase.from("patient_exercise_enrollments").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    programme_id: programmeId,
  });
  return error ? { error: error.message } : {};
}

/**
 * The activity safety gate (S48a). public.activity_gate() is the enforcing answer; the app only reads and shows it. If the question cannot be
 * asked (offline, an error) the answer is the fail-closed one (gentle only), and `unavailable` lets the screen say so rather than pretend.
 */
export async function loadActivityGate(): Promise<{ gate: ActivityGateResult; unavailable: boolean }> {
  const { data, error } = await supabase.rpc("activity_gate");
  if (error) return { gate: unavailableActivityGate(), unavailable: true };
  return { gate: parseActivityGate(data), unavailable: false };
}

export interface WorkoutPlan {
  code: string;
  title: string;
  level: "gentle" | "moderate" | "vigorous";
  format: "home" | "chair_class";
  sessions: { minutes: number; steps: string[] }[];
  /** DRAFT slot: empty until a clinician-reviewed recording exists. Text steps are always shown. */
  audio_clip_ids?: string[];
}

/** Reviewed workout plans the gate allows for this person. Empty until a clinician has reviewed one. */
export async function loadWorkoutPlans(): Promise<WorkoutPlan[]> {
  const { data, error } = await supabase.rpc("my_workout_plans");
  if (error || !Array.isArray(data)) return [];
  return data as unknown as WorkoutPlan[];
}

// ── Session log (P4) ─────────────────────────────────────────────────────────

export type ExerciseSessionLog = Tables<"exercise_session_logs">;

export const EXERCISE_KINDS: { value: "walking" | "mobility" | "strength" | "cardio" | "other"; label: string }[] = [
  { value: "walking", label: "Walking" },
  { value: "mobility", label: "Stretching" },
  { value: "strength", label: "Strength" },
  { value: "cardio", label: "Cardio" },
  { value: "other", label: "Other" },
];
export const EXERCISE_EFFORTS: { value: "easy" | "moderate" | "hard"; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Steady" },
  { value: "hard", label: "Hard" },
];

const SESSION_PAGE = 1000;
const SESSION_MAX_PAGES = 20;

/** Every session the person logged, newest first, read page by page so progress is never counted from a truncated list. */
export async function loadExerciseSessions(patientId: string): Promise<QueryResult<ExerciseSessionLog[]>> {
  const rows: ExerciseSessionLog[] = [];
  for (let page = 0; page < SESSION_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("exercise_session_logs")
      .select("*")
      .eq("patient_id", patientId)
      .order("performed_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * SESSION_PAGE, (page + 1) * SESSION_PAGE - 1);
    if (error) return { ok: false, error: error.message };
    rows.push(...data);
    if (data.length < SESSION_PAGE) break;
  }
  return { ok: true, data: rows };
}

export interface LogSessionInput {
  performedOn: string;
  minutes: number;
  kind: (typeof EXERCISE_KINDS)[number]["value"];
  effort: (typeof EXERCISE_EFFORTS)[number]["value"] | null;
  symptomDuring: boolean;
  enrollmentId: string | null;
  note: string;
}

/**
 * A plain RLS-scoped insert, like the readiness screen. The date window, "that programme is yours" and the clinician alert for a Member who
 * reports a symptom are all database triggers (20261029204012, 20261029211315); the patient-readable trigger message comes back as error.
 */
export async function logExerciseSession(
  patientId: string,
  organisationId: string,
  input: LogSessionInput
): Promise<{ error?: string }> {
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 600) {
    return { error: "Enter between 1 and 600 minutes." };
  }
  const { error } = await supabase.from("exercise_session_logs").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    enrollment_id: input.enrollmentId,
    performed_on: input.performedOn,
    duration_minutes: input.minutes,
    kind: input.kind,
    effort: input.effort,
    symptom_during: input.symptomDuring,
    note: input.note.trim() ? input.note.trim().slice(0, 300) : null,
  });
  return error ? { error: error.message } : {};
}

export async function deleteExerciseSession(patientId: string, id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from("exercise_session_logs").delete().eq("id", id).eq("patient_id", patientId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "That session was already removed." };
  return {};
}
