"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setSmokingProfileSchema, logSmokingCheckInSchema } from "@/lib/validation/smoking";

export type SmokingActionState = { error?: string; success?: boolean } | undefined;

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

/** Africa/Lagos "today" — see CLAUDE.md's "Timezone always Africa/Lagos" rule. */
function lagosToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

export async function setSmokingProfileAction(
  _prev: SmokingActionState,
  formData: FormData,
): Promise<SmokingActionState> {
  const parsed = setSmokingProfileSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("patient_smoking_profiles").upsert(
    {
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      status: parsed.data.status,
      cigarettes_per_day: parsed.data.cigarettes_per_day ?? null,
      years_smoking: parsed.data.years_smoking ?? null,
      quit_motivation: parsed.data.quit_motivation ?? null,
      quit_date: parsed.data.quit_date ?? null,
    },
    { onConflict: "patient_id" },
  );
  if (error) return { error: error.message };

  revalidatePath("/patient/smoking");
  return { success: true };
}

/** Logs (or updates) today's smoking check-in — same update-then-insert
 * shape as activity's step logging, for the same reason: the day's one-row
 * unique index is a partial-style constraint PostgREST's upsert can't
 * target directly. */
export async function logSmokingCheckInAction(
  _prev: SmokingActionState,
  formData: FormData,
): Promise<SmokingActionState> {
  const parsed = logSmokingCheckInSchema.safeParse({
    ...Object.fromEntries(formData.entries()),
    triggers: formData.getAll("triggers"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const today = lagosToday();
  const row = {
    cigarettes_smoked: parsed.data.cigarettes_smoked,
    cravings_intensity: parsed.data.cravings_intensity ?? null,
    triggers: parsed.data.triggers,
    note: parsed.data.note ?? null,
  };

  const { data: updated, error: updateErr } = await ctx.supabase
    .from("smoking_check_ins")
    .update(row)
    .eq("patient_id", ctx.userId)
    .eq("logged_on", today)
    .select("id");
  if (updateErr) return { error: updateErr.message };

  if (!updated || updated.length === 0) {
    const { error: insertErr } = await ctx.supabase.from("smoking_check_ins").insert({
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      logged_on: today,
      ...row,
    });
    if (insertErr) return { error: insertErr.message };
  }

  revalidatePath("/patient/smoking");
  return { success: true };
}
