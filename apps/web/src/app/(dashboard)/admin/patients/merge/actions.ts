"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type MergeResult = {
  dry_run: boolean;
  keep_id: string;
  merge_id: string;
  tables_affected: Record<string, number>;
  merge_log_id?: string;
};

export type MergePatientsState = { error?: string; result?: MergeResult } | undefined;

async function requireMergeAuthority() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!profile || (!isSuperAdmin && !keys.has("patients.merge"))) {
    return null;
  }
  return profile;
}

function parseMergeForm(formData: FormData) {
  const keepId = formData.get("keepId");
  const mergeId = formData.get("mergeId");
  const reason = formData.get("reason");
  if (typeof keepId !== "string" || typeof mergeId !== "string" || typeof reason !== "string") {
    return null;
  }
  if (!keepId || !mergeId || !reason.trim()) return null;
  return { keepId, mergeId, reason: reason.trim() };
}

/** Dry run — computes exactly what would move, changes nothing. */
export async function previewPatientMerge(
  _prevState: MergePatientsState,
  formData: FormData,
): Promise<MergePatientsState> {
  if (!(await requireMergeAuthority())) return { error: "Not authorised" };

  const parsed = parseMergeForm(formData);
  if (!parsed) return { error: "Pick both profiles and enter a reason" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_merge_patient_records", {
    p_keep_id: parsed.keepId,
    p_merge_id: parsed.mergeId,
    p_reason: parsed.reason,
    p_dry_run: true,
  });
  if (error) return { error: error.message };

  return { result: data as MergeResult };
}

/** The real merge — every FK'd row found by the dry run is repointed, the losing profile is
 * retired, and a patient_merge_log snapshot is written. Irreversible except by hand. */
export async function confirmPatientMerge(
  _prevState: MergePatientsState,
  formData: FormData,
): Promise<MergePatientsState> {
  if (!(await requireMergeAuthority())) return { error: "Not authorised" };

  const parsed = parseMergeForm(formData);
  if (!parsed) return { error: "Pick both profiles and enter a reason" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_merge_patient_records", {
    p_keep_id: parsed.keepId,
    p_merge_id: parsed.mergeId,
    p_reason: parsed.reason,
    p_dry_run: false,
  });
  if (error) return { error: error.message };

  // Mark any duplicate flag for this exact pair as merged, in either id order.
  await supabase
    .from("patient_duplicate_flags")
    .update({ status: "merged" })
    .or(
      `and(profile_id_a.eq.${parsed.keepId},profile_id_b.eq.${parsed.mergeId}),and(profile_id_a.eq.${parsed.mergeId},profile_id_b.eq.${parsed.keepId})`,
    );

  revalidatePath("/admin/patients/duplicates");
  return { result: data as MergeResult };
}
