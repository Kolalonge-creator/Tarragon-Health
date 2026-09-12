import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

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
 * insert, no service-role route needed (unlike the adolescent/mental-health
 * check-ins, nothing here computes a safety flag client-side that a
 * malicious client could spoof; private.enforce_exercise_readiness is the
 * DB-side gate and is re-checked on every enrollment attempt regardless). */
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
