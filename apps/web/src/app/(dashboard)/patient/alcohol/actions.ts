"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setAlcoholGoalSchema, logAlcoholConsumptionSchema } from "@/lib/validation/alcohol";

export type AlcoholActionState = { error?: string; success?: boolean } | undefined;

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

function lagosToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

export async function setAlcoholGoalAction(
  _prev: AlcoholActionState,
  formData: FormData,
): Promise<AlcoholActionState> {
  const parsed = setAlcoholGoalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { data: existing } = await ctx.supabase
    .from("patient_alcohol_goals")
    .select("baseline_drinks_per_week")
    .eq("patient_id", ctx.userId)
    .maybeSingle();

  const { error } = await ctx.supabase.from("patient_alcohol_goals").upsert(
    {
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      target_drinks_per_week: parsed.data.target_drinks_per_week,
      // Baseline is set once, the first time a goal is created, so progress
      // can be measured against where the patient actually started.
      baseline_drinks_per_week: existing?.baseline_drinks_per_week ?? parsed.data.target_drinks_per_week,
    },
    { onConflict: "patient_id" },
  );
  if (error) return { error: error.message };

  revalidatePath("/patient/alcohol");
  return { success: true };
}

export async function logAlcoholConsumptionAction(
  _prev: AlcoholActionState,
  formData: FormData,
): Promise<AlcoholActionState> {
  const parsed = logAlcoholConsumptionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const today = lagosToday();
  const row = {
    drinks_count: parsed.data.drinks_count,
    context: parsed.data.context ?? null,
  };

  const { data: updated, error: updateErr } = await ctx.supabase
    .from("alcohol_consumption_logs")
    .update(row)
    .eq("patient_id", ctx.userId)
    .eq("logged_on", today)
    .select("id");
  if (updateErr) return { error: updateErr.message };

  if (!updated || updated.length === 0) {
    const { error: insertErr } = await ctx.supabase.from("alcohol_consumption_logs").insert({
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      logged_on: today,
      ...row,
    });
    if (insertErr) return { error: insertErr.message };
  }

  revalidatePath("/patient/alcohol");
  return { success: true };
}
