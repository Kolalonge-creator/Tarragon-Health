"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type SaveCvProfileState = { error?: string; success?: boolean } | undefined;

const cvProfileSchema = z.object({
  established_ascvd: z.coerce.boolean(),
  prior_mi: z.coerce.boolean(),
  prior_stroke_tia: z.coerce.boolean(),
  prior_pad: z.coerce.boolean(),
  prior_revascularisation: z.coerce.boolean(),
  familial_hypercholesterolaemia: z.coerce.boolean(),
  notes: z.string().max(2000).optional(),
});

/**
 * Records a patient's cardiovascular-risk profile (prior events / established
 * ASCVD / FH) — a clinical judgement, so it's staff-authored and stamps
 * recorded_by from the acting clinician's own clinical_staff record (never
 * client-supplied). Drives the primary-vs-secondary-prevention split in the
 * CV-risk engine; it does not itself prescribe anything.
 */
export async function saveCvProfile(
  patientId: string,
  _prev: SaveCvProfileState,
  formData: FormData
): Promise<SaveCvProfileState> {
  // Unchecked checkboxes are absent from FormData → coerce presence to boolean.
  const raw = {
    established_ascvd: formData.has("established_ascvd"),
    prior_mi: formData.has("prior_mi"),
    prior_stroke_tia: formData.has("prior_stroke_tia"),
    prior_pad: formData.has("prior_pad"),
    prior_revascularisation: formData.has("prior_revascularisation"),
    familial_hypercholesterolaemia: formData.has("familial_hypercholesterolaemia"),
    notes: (formData.get("notes") as string | null) ?? undefined,
  };
  const parsed = cvProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "Only clinical staff can record a cardiovascular profile" };

  const { data: patient } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", patientId)
    .maybeSingle();
  if (!patient?.organisation_id) return { error: "Patient has no organisation on file" };

  const { error } = await supabase.from("patient_cardiovascular_profile").upsert(
    {
      organisation_id: patient.organisation_id,
      patient_id: patientId,
      ...parsed.data,
      recorded_by: staff.id,
    },
    { onConflict: "patient_id" }
  );
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}
