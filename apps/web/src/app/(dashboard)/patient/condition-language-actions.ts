"use server";

import { createClient } from "@/lib/supabase/server";

export type UpdateConditionLanguageState = { success?: boolean; error?: string } | undefined;

/**
 * Saves profiles.condition_language_preference — lets a patient opt into
 * clinical wording ("obesity") for their own UI instead of the platform's
 * gentler default ("weight"). Never affects clinical records, coding, or
 * clinician-facing copy, only the small set of surfaces that read it.
 */
export async function updateConditionLanguagePreference(
  _prevState: UpdateConditionLanguageState,
  formData: FormData
): Promise<UpdateConditionLanguageState> {
  const raw = formData.get("condition_language_preference");
  const value = raw === "clinical" ? "clinical" : "gentle";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({ condition_language_preference: value })
    .eq("id", user.id);
  if (error) return { error: error.message };

  return { success: true };
}
