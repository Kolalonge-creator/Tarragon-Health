"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { weightGoalSchema } from "@/lib/validation/weight-goal";

export type WeightGoalActionState = { error?: string; success?: boolean } | undefined;

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

/** Sets or edits the patient's single active weight goal (upsert on
 * patient_id — a fresh save replaces the old one, matching the source
 * screenshot's single editable "My Weight Goal" block). */
export async function setWeightGoalAction(
  _prev: WeightGoalActionState,
  formData: FormData,
): Promise<WeightGoalActionState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = weightGoalSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("patient_weight_goals").upsert(
    {
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      starting_weight_kg: parsed.data.starting_weight_kg,
      goal_weight_kg: parsed.data.goal_weight_kg,
    },
    { onConflict: "patient_id" },
  );
  if (error) return { error: error.message };

  revalidatePath("/patient/weight");
  return { success: true };
}
