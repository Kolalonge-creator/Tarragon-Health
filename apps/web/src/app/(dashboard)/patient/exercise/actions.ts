"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  exerciseReadinessScreenSchema,
  enrollExerciseProgrammeSchema,
  logExerciseSessionSchema,
  deleteExerciseSessionSchema,
} from "@/lib/validation/exercise";

export type ExerciseActionState = { error?: string; success?: boolean } | undefined;

async function currentPatient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" as const };
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" as const };
  return { supabase, userId: user.id, organisationId: profile.organisation_id };
}

export async function submitReadinessScreenAction(
  _prev: ExerciseActionState,
  formData: FormData,
): Promise<ExerciseActionState> {
  const parsed = exerciseReadinessScreenSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("exercise_readiness_screens").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    chest_pain: parsed.data.chest_pain,
    dizziness_or_balance: parsed.data.dizziness_or_balance,
    joint_bone_problem: parsed.data.joint_bone_problem,
    doctor_advised_limit: parsed.data.doctor_advised_limit,
    heart_or_bp_condition: parsed.data.heart_or_bp_condition,
    other_concern: parsed.data.other_concern ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/exercise");
  return { success: true };
}

/**
 * The DB's enforce_exercise_readiness trigger is the real safety gate
 * (spec §18.6) — it raises a plain Postgres exception with a patient-
 * readable message when a moderate/vigorous programme needs a screen (or
 * clinician clearance) that doesn't exist yet, which surfaces here as
 * error.message. This action never re-implements that check client-side.
 */
export async function enrollExerciseProgrammeAction(
  _prev: ExerciseActionState,
  formData: FormData,
): Promise<ExerciseActionState> {
  const parsed = enrollExerciseProgrammeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("patient_exercise_enrollments").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    programme_id: parsed.data.programme_id,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/exercise");
  return { success: true };
}

export type LogSessionState =
  { error?: string; success?: boolean; symptomReported?: boolean } | undefined;

/**
 * Record a session the person did. The database trigger is the real check on the date window and on the programme being theirs; its
 * patient-readable message comes back as error.message. A reported symptom changes what the page says (stop, rest, get help if it persists);
 * it creates no clinician alert on its own.
 */
export async function logExerciseSessionAction(
  _prev: LogSessionState,
  formData: FormData,
): Promise<LogSessionState> {
  const parsed = logExerciseSessionSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("exercise_session_logs").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    enrollment_id: parsed.data.enrollment_id ?? null,
    performed_on: parsed.data.performed_on,
    duration_minutes: parsed.data.duration_minutes,
    kind: parsed.data.kind,
    effort: parsed.data.effort ?? null,
    symptom_during: parsed.data.symptom_during,
    note: parsed.data.note ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/exercise");
  return { success: true, symptomReported: parsed.data.symptom_during };
}

/** A wrong entry is removed and logged again. RLS limits the delete to the person's own rows. */
export async function deleteExerciseSessionAction(
  id: string,
): Promise<ExerciseActionState> {
  const parsed = deleteExerciseSessionSchema.safeParse({ id });
  if (!parsed.success) return { error: "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { data, error } = await ctx.supabase
    .from("exercise_session_logs")
    .delete()
    .eq("id", parsed.data.id)
    .eq("patient_id", ctx.userId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "That session was already removed." };

  revalidatePath("/patient/exercise");
  return { success: true };
}
