"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import {
  wellbeingCheckinSchema,
  wellbeingReminderFrequencySchema,
} from "@/lib/validation/wellbeing";

export type WellbeingActionState = { error?: string; success?: boolean } | undefined;

/**
 * Records a wellbeing self check-in (Module 46 §46.2/§46.13) — mood, stress,
 * sleep, activity, all self-report, never a clinical instrument and never
 * fed into escalation logic (that's mental-health-actions.ts). Inserted
 * under the caller's own RLS session, same as vitals/symptoms; a supporter
 * acting for a dependent is covered by the existing
 * wellbeing_checkins_insert_acting_supporter policy.
 */
export async function logWellbeingCheckin(
  _prevState: WellbeingActionState,
  formData: FormData
): Promise<WellbeingActionState> {
  const parsed = wellbeingCheckinSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please answer every question" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const subjectId = await resolveSubjectId(user.id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error } = await supabase.from("wellbeing_checkins").insert({
    ...parsed.data,
    patient_id: subjectId,
    organisation_id: profile.organisation_id,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/wellbeing");
  return { success: true };
}

/**
 * Updates how often the patient wants to be prompted to check in — §46.13
 * "the patient controls how frequently they track". Upserted under the
 * caller's own RLS session.
 */
export async function updateWellbeingCheckinFrequency(
  _prevState: WellbeingActionState,
  formData: FormData
): Promise<WellbeingActionState> {
  const parsed = wellbeingReminderFrequencySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid frequency" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const subjectId = await resolveSubjectId(user.id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error } = await supabase.from("wellbeing_checkin_preferences").upsert({
    patient_id: subjectId,
    organisation_id: profile.organisation_id,
    reminder_frequency_days: parsed.data.reminder_frequency_days,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/wellbeing");
  return { success: true };
}
