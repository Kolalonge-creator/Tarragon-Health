"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";

export type RecordChangeDecisionState =
  { error?: string; message?: string } | undefined;

const confirmSchema = z.object({
  id: z.string().uuid(),
});

const rejectSchema = z.object({
  id: z.string().uuid(),
  // Internal only: the note is stored for clinicians and never reaches the patient (INV-07).
  note: z
    .string()
    .trim()
    .max(1000, "Keep the note under 1000 characters")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

const QUEUE_PATH = "/clinician/record-changes";

/**
 * App-layer gate (CLAUDE.md: a Care Coordinator never gains write access to anything
 * clinical). The database is the real boundary: confirm_patient_allergy_correction
 * and reject_patient_allergy_correction refuse anyone who is not a tied, active,
 * non-coordinator clinician, and answer a missing request the same way. This check
 * only gives a coordinator a plain message instead of that generic refusal.
 */
async function requireClinicalTier(): Promise<{ error: string } | null> {
  const staff = await getCurrentClinicalStaff();
  if (!isClinicalTier(staff)) {
    return { error: "Only a doctor can decide a record change request." };
  }
  return null;
}

/** Confirm: the same correction path a clinician's own correction uses; the patient gets a plain in-app notice. */
export async function confirmRecordChange(
  _prev: RecordChangeDecisionState,
  formData: FormData,
): Promise<RecordChangeDecisionState> {
  const parsed = confirmSchema.safeParse({
    id: String(formData.get("id") ?? ""),
  });
  if (!parsed.success)
    return {
      error: "That request could not be read. Refresh the page and try again.",
    };

  const gate = await requireClinicalTier();
  if (gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_patient_allergy_correction", {
    p_request_id: parsed.data.id,
  });
  if (error) return { error: error.message };

  revalidatePath(QUEUE_PATH);
  return { message: "Confirmed. The record has been changed." };
}

/** Reject: the record stays as it was; the patient gets a plain notice that names nothing, and never sees the note. */
export async function rejectRecordChange(
  _prev: RecordChangeDecisionState,
  formData: FormData,
): Promise<RecordChangeDecisionState> {
  const rawNote = formData.get("note");
  const parsed = rejectSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    note: typeof rawNote === "string" ? rawNote : undefined,
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "That request could not be read.",
    };
  }

  const gate = await requireClinicalTier();
  if (gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_patient_allergy_correction", {
    p_request_id: parsed.data.id,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) return { error: error.message };

  revalidatePath(QUEUE_PATH);
  return { message: "Left as it was. The patient has been told." };
}
