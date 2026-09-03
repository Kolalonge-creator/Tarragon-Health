"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setSleepGoalSchema, logSleepEntrySchema } from "@/lib/validation/sleep";
import { flagAbnormalSleep } from "@/lib/sleep/escalate";

export type SleepActionState = { error?: string; success?: boolean } | undefined;

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

export async function setSleepGoalAction(
  _prev: SleepActionState,
  formData: FormData,
): Promise<SleepActionState> {
  const parsed = setSleepGoalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("patient_sleep_goals").upsert(
    {
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      target_duration_hours: parsed.data.target_duration_hours ?? null,
      target_bedtime: parsed.data.target_bedtime ?? null,
      target_waketime: parsed.data.target_waketime ?? null,
    },
    { onConflict: "patient_id" },
  );
  if (error) return { error: error.message };

  revalidatePath("/patient/sleep");
  return { success: true };
}

export async function logSleepEntryAction(
  _prev: SleepActionState,
  formData: FormData,
): Promise<SleepActionState> {
  const parsed = logSleepEntrySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const today = lagosToday();
  const row = {
    duration_hours: parsed.data.duration_hours,
    quality_rating: parsed.data.quality_rating ?? null,
    bedtime: parsed.data.bedtime ?? null,
    waketime: parsed.data.waketime ?? null,
    daytime_sleepiness: parsed.data.daytime_sleepiness ?? null,
    note: parsed.data.note ?? null,
  };

  const { data: updated, error: updateErr } = await ctx.supabase
    .from("sleep_log_entries")
    .update(row)
    .eq("patient_id", ctx.userId)
    .eq("logged_on", today)
    .select("id");
  if (updateErr) return { error: updateErr.message };

  if (!updated || updated.length === 0) {
    const { error: insertErr } = await ctx.supabase.from("sleep_log_entries").insert({
      organisation_id: ctx.organisationId,
      patient_id: ctx.userId,
      logged_on: today,
      ...row,
    });
    if (insertErr) return { error: insertErr.message };
  }

  // Best-effort — never blocks the patient's own log from saving.
  await flagAbnormalSleep(ctx.userId, ctx.organisationId, {
    duration_hours: row.duration_hours,
    daytime_sleepiness: row.daytime_sleepiness,
  }).catch(() => undefined);

  revalidatePath("/patient/sleep");
  return { success: true };
}
