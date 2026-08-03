"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Database } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

const schema = z.object({
  patient_id: z.string().uuid(),
  blood_group: z.enum(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"]).nullable(),
  genotype: z.enum(["AA", "AS", "AC", "SS", "SC", "CC", "other"]).nullable(),
  genotype_note: z.string().max(200).nullable(),
  source: z.enum(["lab_result", "patient_reported", "clinician_recorded"]),
});

export type BloodProfileResult = { error?: string; message?: string };

/**
 * Record a patient's blood group and genotype.
 *
 * Written through the caller's own session so `patient_blood_profile`'s
 * org-staff write policy is the real gate — this action adds no privilege.
 * `recorded_by` is derived from the caller, never accepted from the client.
 */
export async function saveBloodProfile(input: unknown): Promise<BloodProfileResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  if (!data.blood_group && !data.genotype) {
    return { error: "Record at least a blood group or a genotype." };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();

  const { data: patient } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", data.patient_id)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient?.organisation_id) {
    return { error: "That patient isn't in your organisation." };
  }

  const row: Database["public"]["Tables"]["patient_blood_profile"]["Insert"] = {
    patient_id: data.patient_id,
    organisation_id: patient.organisation_id,
    blood_group: data.blood_group,
    genotype: data.genotype,
    // A note only makes sense against 'other'; clearing the genotype clears it
    // too, so a stale variant description can never outlive the fact it described.
    genotype_note: data.genotype === "other" ? data.genotype_note : null,
    source: data.source,
    recorded_by: user.id,
    recorded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("patient_blood_profile")
    .upsert(row, { onConflict: "patient_id" });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${data.patient_id}`);
  revalidatePath("/patient/emergency-card");
  return { message: "Saved." };
}
