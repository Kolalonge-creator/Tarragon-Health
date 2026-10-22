"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseLagosLocal } from "@/lib/clinical/lagos-local";

export type RecordCuffCheckState = { error?: string; success?: boolean } | undefined;

const systolic = z.coerce.number().int().min(60, "Systolic must be between 60 and 260.").max(260, "Systolic must be between 60 and 260.");
const diastolic = z.coerce.number().int().min(30, "Diastolic must be between 30 and 160.").max(160, "Diastolic must be between 30 and 160.");

const schema = z
  .object({
    patient_id: z.string().uuid(),
    clinic_systolic: systolic,
    clinic_diastolic: diastolic,
    own_systolic: systolic,
    own_diastolic: diastolic,
    measured_at: z.string().min(1, "Enter when the two readings were taken."),
    device_label: z.string().max(80, "Keep the device label under 80 characters.").optional(),
  })
  .refine((v) => v.clinic_systolic > v.clinic_diastolic, { message: "The clinic systolic must be higher than the diastolic.", path: ["clinic_systolic"] })
  .refine((v) => v.own_systolic > v.own_diastolic, { message: "The patient's cuff systolic must be higher than the diastolic.", path: ["own_systolic"] });

/**
 * A same-visit pair (S07y): the clinic reading and the reading from the patient's own cuff, taken together. It goes to its own table, never to the patient's home
 * log, so it raises no home alert. The database checks that the clinician is tied to the patient. It is never shown to the patient.
 */
export async function recordCuffCheckPair(_prev: RecordCuffCheckState, formData: FormData): Promise<RecordCuffCheckState> {
  const parsed = schema.safeParse({
    patient_id: String(formData.get("patient_id") ?? ""),
    clinic_systolic: formData.get("clinic_systolic"),
    clinic_diastolic: formData.get("clinic_diastolic"),
    own_systolic: formData.get("own_systolic"),
    own_diastolic: formData.get("own_diastolic"),
    measured_at: String(formData.get("measured_at") ?? ""),
    device_label: String(formData.get("device_label") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const measured = parseLagosLocal(parsed.data.measured_at);
  if (!measured) return { error: "Enter a valid date and time." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_cuff_check_pair", {
    p_patient: parsed.data.patient_id,
    p_clinic_systolic: parsed.data.clinic_systolic,
    p_clinic_diastolic: parsed.data.clinic_diastolic,
    p_own_systolic: parsed.data.own_systolic,
    p_own_diastolic: parsed.data.own_diastolic,
    p_measured_at: measured.toISOString(),
    ...(parsed.data.device_label ? { p_device_label: parsed.data.device_label } : {}),
  });
  if (error) {
    if (error.code === "42501") return { error: "You can only record a pair for a patient on your care team." };
    if (error.code === "22023") return { error: "Those readings, the time or the device label are not usable. Check them and try again." };
    return { error: "That did not work. Please try again." };
  }
  revalidatePath(`/clinician/patients/${parsed.data.patient_id}`);
  return { success: true };
}
