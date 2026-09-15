"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { reportLifestyleBarrierSchema } from "@/lib/validation/lifestyle-barriers";

export type BarrierActionState = { error?: string; success?: boolean } | undefined;

/**
 * Records a "what's making this difficult?" check-in (spec §18.14) against
 * any lifestyle domain — shared by every domain page (weight, activity,
 * smoking, alcohol, sleep) rather than duplicated per page, since the shape
 * is identical everywhere except which domain it's tagged with.
 */
export async function reportLifestyleBarrierAction(
  _prev: BarrierActionState,
  formData: FormData,
): Promise<BarrierActionState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = reportLifestyleBarrierSchema.safeParse({
    ...raw,
    barrier_codes: formData.getAll("barrier_codes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error } = await supabase.from("lifestyle_barrier_reports").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    domain: parsed.data.domain,
    barrier_codes: parsed.data.barrier_codes,
    note: parsed.data.note ?? null,
  });
  if (error) return { error: error.message };

  const pathByDomain: Record<string, string> = {
    nutrition: "/patient/nutrition",
    activity: "/patient/activity",
    weight: "/patient/weight",
    sleep: "/patient/sleep",
    smoking: "/patient/smoking",
    alcohol: "/patient/alcohol",
    stress: "/patient/lifestyle",
  };
  revalidatePath(pathByDomain[parsed.data.domain] ?? "/patient/lifestyle");
  return { success: true };
}
