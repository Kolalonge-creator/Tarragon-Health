"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPatientGoalSchema, logGoalProgressSchema } from "@/lib/validation/patient-goal";

export type GoalActionState = { error?: string; success?: boolean } | undefined;

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

/** §16.10 — a patient defines a personal health goal, optionally linked to
 * their care plan. */
export async function createPatientGoalAction(
  _prev: GoalActionState,
  formData: FormData
): Promise<GoalActionState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = createPatientGoalSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { target_value, target_unit, care_plan_id, ...rest } = parsed.data;
  const { error } = await ctx.supabase.from("patient_goals").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    ...rest,
    target_value: target_value === "" || target_value === undefined ? null : target_value,
    target_unit: target_unit === "" || target_unit === undefined ? null : target_unit,
    care_plan_id: care_plan_id === "" || care_plan_id === undefined ? null : care_plan_id,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/care");
  return { success: true };
}

/** §16.11 — one progress entry per calendar day; re-logging the same day
 * overwrites rather than duplicates. */
export async function logGoalProgressAction(
  _prev: GoalActionState,
  formData: FormData
): Promise<GoalActionState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = logGoalProgressSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("patient_goal_progress").upsert(
    {
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      goal_id: parsed.data.goal_id,
      logged_date: parsed.data.logged_date,
      value: parsed.data.value,
    },
    { onConflict: "goal_id,logged_date" }
  );
  if (error) return { error: error.message };

  revalidatePath("/patient/care");
  return { success: true };
}

/** Marking a goal achieved is what feeds the patient_goal_achieved milestone
 * on the next nightly compute — see compute_care_engagement_scores(). */
export async function markGoalAchievedAction(
  _prev: GoalActionState,
  formData: FormData
): Promise<GoalActionState> {
  const goalId = formData.get("goal_id");
  if (typeof goalId !== "string" || goalId.length === 0) {
    return { error: "Missing goal" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("patient_goals")
    .update({ status: "achieved", achieved_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("patient_id", ctx.userId);
  if (error) return { error: error.message };

  revalidatePath("/patient/care");
  return { success: true };
}
