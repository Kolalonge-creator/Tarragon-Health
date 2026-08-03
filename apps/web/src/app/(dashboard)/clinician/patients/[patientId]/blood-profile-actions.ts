"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { BLOOD_ATTESTATION_VERSION } from "@/lib/clinical/blood-attestation";

const bloodGroup = z.enum(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"]);
const genotype = z.enum(["AA", "AS", "AC", "SS", "SC", "CC", "other"]);

const staffSchema = z.object({
  patient_id: z.string().uuid(),
  blood_group: bloodGroup.nullable(),
  genotype: genotype.nullable(),
  genotype_note: z.string().max(200).nullable(),
  /** The uploaded report this was read off. Required — see the migration. */
  document_id: z.string().uuid({ message: "Choose the lab report this came from" }),
});

const patientSchema = z.object({
  blood_group: bloodGroup.nullable(),
  genotype: genotype.nullable(),
  genotype_note: z.string().max(200).nullable(),
  attested: z.literal(true, {
    // z.literal's message fires when the box is unticked.
    message: "Tick the confirmation to record this",
  }),
});

export type BloodProfileResult = { error?: string; message?: string };

/**
 * A clinician records blood group / genotype FROM A LAB REPORT.
 *
 * There is no unsourced path here any more. The DB refuses a `lab_document` row
 * without a linked report, and refuses a report belonging to a different
 * patient, so `document_id` is not a nicety — it is the evidence.
 */
export async function saveBloodProfileFromReport(input: unknown): Promise<BloodProfileResult> {
  const parsed = staffSchema.safeParse(input);
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

  const { error } = await supabase.from("patient_blood_profile").upsert(
    {
      patient_id: data.patient_id,
      organisation_id: patient.organisation_id,
      blood_group: data.blood_group,
      genotype: data.genotype,
      genotype_note: data.genotype_note,
      provenance: "lab_document",
      document_id: data.document_id,
      attested_at: null,
      attestation_version: null,
      recorded_by: user.id,
    },
    { onConflict: "patient_id" },
  );
  if (error) return { error: friendly(error.message) };

  revalidatePath(`/clinician/patients/${data.patient_id}`);
  revalidatePath("/patient/emergency-card");
  return { message: "Saved against the report." };
}

/**
 * A patient records their OWN blood group / genotype by attesting to it.
 *
 * `provenance`, `attested_at` and `recorded_by` are all forced server-side by
 * `private.enforce_blood_profile_provenance` regardless of what is sent here —
 * this action cannot mark a value lab-backed even if it tried. What it does
 * supply is the attestation VERSION, so the exact wording the patient agreed to
 * is recoverable later.
 */
export async function attestBloodProfile(input: unknown): Promise<BloodProfileResult> {
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  if (!data.blood_group && !data.genotype) {
    return { error: "Choose at least a blood group or a genotype." };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!me?.organisation_id) return { error: "Your account has no organisation on file." };

  const { error } = await supabase.from("patient_blood_profile").upsert(
    {
      patient_id: user.id,
      organisation_id: me.organisation_id,
      blood_group: data.blood_group,
      genotype: data.genotype,
      genotype_note: data.genotype_note,
      provenance: "patient_attested",
      attestation_version: BLOOD_ATTESTATION_VERSION,
    },
    { onConflict: "patient_id" },
  );
  if (error) return { error: friendly(error.message) };

  revalidatePath("/patient/emergency-card");
  revalidatePath("/patient");
  return {
    message:
      "Recorded as your own confirmation. Upload the lab report when you can and your care team will confirm it.",
  };
}

/** Turn the DB's own guard messages into something a human can act on. */
function friendly(message: string): string {
  if (/does not belong to this patient/i.test(message)) {
    return "That report is not on this patient's record.";
  }
  if (/must link the report/i.test(message)) {
    return "Choose the lab report this came from.";
  }
  if (/provenance_complete/i.test(message)) {
    return "A blood group or genotype needs either a linked lab report or the patient's own confirmation.";
  }
  return message;
}
