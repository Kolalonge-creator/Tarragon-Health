"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type CreateSignoffDraftState = { error?: string; success?: boolean } | undefined;
export type SignVaccinationScheduleState = { error?: string; success?: boolean } | undefined;

/**
 * Create a new sign-off draft, snapshotting the CURRENT active
 * vaccination_catalog rows so the record shows exactly what was reviewed at
 * this moment — never re-derived later from a catalog that may have since
 * changed. Inserted as unsigned/inactive (RLS forces this); a Clinical
 * Director then signs it via signVaccinationScheduleAction below.
 */
export async function createVaccinationScheduleDraftAction(
  _prev: CreateSignoffDraftState,
  formData: FormData
): Promise<CreateSignoffDraftState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { data: catalog, error: catalogError } = await supabase
    .from("vaccination_catalog")
    .select("id, code, name, description, recommended_age, is_active")
    .eq("is_active", true)
    .order("code", { ascending: true });
  if (catalogError) return { error: catalogError.message };

  const { data: latest } = await supabase
    .from("vaccination_schedule_signoffs")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const sourceUrl = String(formData.get("source_url") ?? "").trim() || null;
  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Reviewed and drafted by admin, version ${nextVersion}. Sign to bring into force.`;

  const { error } = await supabase.from("vaccination_schedule_signoffs").insert({
    version: nextVersion,
    notes,
    source_url: sourceUrl,
    catalog_snapshot: catalog,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/vaccination-schedule");
  return { success: true };
}

/**
 * Sign and activate a vaccination-schedule sign-off. The DB RPC
 * (sign_vaccination_schedule) is the real gate — it only succeeds for an
 * active Clinical Director, stamps approved_by from the caller's own
 * clinical_staff record, and deactivates any prior active sign-off. A
 * signature cannot be forged from the app layer.
 */
export async function signVaccinationScheduleAction(
  signoffId: string
): Promise<SignVaccinationScheduleState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_vaccination_schedule", {
    p_signoff_id: signoffId,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/vaccination-schedule");
  return { success: true };
}
