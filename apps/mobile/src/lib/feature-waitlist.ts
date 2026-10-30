import { supabase } from "./supabase";

/** The features a patient can ask to hear about. Must match the check constraint on public.feature_waitlist. */
export type WaitlistFeature = "consultations" | "membership" | "directory" | "community" | "course";

/** Whether the signed-in patient is on the list. null means the read failed: the screen shows nothing rather than guess "not on the list". */
export async function isOnWaitlist(feature: WaitlistFeature): Promise<boolean | null> {
  const { data, error } = await supabase.from("feature_waitlist").select("id").eq("feature_key", feature).maybeSingle();
  if (error) return null;
  return data !== null;
}

/** Join or leave. Row-level security scopes both to the signed-in patient. Already being on the list counts as joined. */
export async function setOnWaitlist(feature: WaitlistFeature, join: boolean): Promise<boolean> {
  try {
    if (!join) {
      const { error } = await supabase.from("feature_waitlist").delete().eq("feature_key", feature);
      return !error;
    }
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return false;
    const { data: profile, error: profileError } = await supabase.from("profiles").select("organisation_id").eq("id", userId).single();
    if (profileError || !profile?.organisation_id) return false;
    const { error } = await supabase.from("feature_waitlist").insert({ organisation_id: profile.organisation_id, patient_id: userId, feature_key: feature });
    return !error || error.code === "23505";
  } catch {
    return false;
  }
}
