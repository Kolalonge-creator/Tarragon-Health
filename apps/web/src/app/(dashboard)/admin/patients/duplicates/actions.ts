"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type DuplicateFlagActionState = { error?: string } | undefined;

async function requireDuplicatesReviewer() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!profile || (!isSuperAdmin && !keys.has("patients.duplicates.review"))) {
    return null;
  }
  return profile;
}

/** Marks a flagged pair as not a duplicate — the sweep never re-flags a dismissed pair. */
export async function dismissDuplicateFlag(
  _prevState: DuplicateFlagActionState,
  formData: FormData,
): Promise<DuplicateFlagActionState> {
  const profile = await requireDuplicatesReviewer();
  if (!profile) return { error: "Not authorised" };

  const id = formData.get("id");
  if (typeof id !== "string") return { error: "Invalid request" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("patient_duplicate_flags")
    .update({ status: "dismissed", reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/patients/duplicates");
  return undefined;
}

/** Runs the detection sweep on demand, gated the same way the DB function gates it internally. */
export async function runDuplicateSweep(
  _prevState: DuplicateFlagActionState,
  _formData: FormData,
): Promise<DuplicateFlagActionState> {
  const profile = await requireDuplicatesReviewer();
  if (!profile) return { error: "Not authorised" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_run_duplicate_patient_sweep");
  if (error) return { error: error.message };

  revalidatePath("/admin/patients/duplicates");
  return undefined;
}
