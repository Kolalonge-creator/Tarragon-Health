"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  setActivityGoalSchema,
  logStepsSchema,
  logWorkoutSchema,
} from "@/lib/validation/activity";

export type ActivityActionState = { error?: string; success?: boolean } | undefined;

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

/** Africa/Lagos "today" as a plain date — see CLAUDE.md's "Timezone always
 * Africa/Lagos" rule; used both for the steps upsert key and workout logging. */
function lagosToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

export async function setActivityGoalAction(
  _prev: ActivityActionState,
  formData: FormData,
): Promise<ActivityActionState> {
  const parsed = setActivityGoalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("patient_activity_goals").upsert(
    {
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      daily_step_goal: parsed.data.daily_step_goal,
    },
    { onConflict: "patient_id" },
  );
  if (error) return { error: error.message };

  revalidatePath("/patient/activity");
  return { success: true };
}

/** Logs (or updates) today's step count. The one-row-per-day constraint is a
 * PARTIAL unique index (patient_id, logged_on) where entry_type='steps' — a
 * plain PostgREST .upsert()'s ON CONFLICT target can't infer a partial index
 * unless its WHERE predicate is repeated verbatim, which the client library
 * has no way to express. Update-then-insert-if-unmatched instead: correct,
 * and safe here since a patient only ever races against their own writes. */
export async function logStepsAction(
  _prev: ActivityActionState,
  formData: FormData,
): Promise<ActivityActionState> {
  const parsed = logStepsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const today = lagosToday();
  const nowIso = new Date().toISOString();

  const { data: updated, error: updateErr } = await ctx.supabase
    .from("activity_log_entries")
    .update({ step_count: parsed.data.step_count, logged_at: nowIso })
    .eq("patient_id", ctx.userId)
    .eq("entry_type", "steps")
    .eq("logged_on", today)
    .select("id");
  if (updateErr) return { error: updateErr.message };

  if (!updated || updated.length === 0) {
    const { error: insertErr } = await ctx.supabase.from("activity_log_entries").insert({
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      entry_type: "steps",
      step_count: parsed.data.step_count,
      logged_on: today,
      logged_at: nowIso,
    });
    if (insertErr) return { error: insertErr.message };
  }

  revalidatePath("/patient/activity");
  return { success: true };
}

export async function logWorkoutAction(
  _prev: ActivityActionState,
  formData: FormData,
): Promise<ActivityActionState> {
  const raw = Object.fromEntries(formData.entries());
  const cleaned = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]));
  const parsed = logWorkoutSchema.safeParse(cleaned);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("activity_log_entries").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    entry_type: "workout",
    activity_name: parsed.data.activity_name,
    duration_minutes: parsed.data.duration_minutes,
    note: parsed.data.note ?? null,
    logged_on: lagosToday(),
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/activity");
  return { success: true };
}

export async function toggleActivityFavoriteAction(entryId: string, isFavorite: boolean) {
  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("activity_log_entries")
    .update({ is_favorite: isFavorite })
    .eq("id", entryId)
    .eq("patient_id", ctx.userId);
  if (error) return { error: error.message };

  revalidatePath("/patient/activity");
  return { success: true };
}
