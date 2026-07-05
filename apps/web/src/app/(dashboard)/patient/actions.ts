"use server";

import { createClient } from "@/lib/supabase/server";
import { vitalsReadingSchema } from "@/lib/validation/vitals";

export type LogVitalActionState = { error?: string; success?: boolean } | undefined;

export async function logVital(
  _prevState: LogVitalActionState,
  formData: FormData
): Promise<LogVitalActionState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = vitalsReadingSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "No organisation on file" };
  }

  const { taken_at, ...reading } = parsed.data;

  const { error } = await supabase.from("vitals_readings").insert({
    ...reading,
    taken_at: taken_at ? new Date(taken_at).toISOString() : undefined,
    patient_id: user.id,
    organisation_id: profile.organisation_id,
  });
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
