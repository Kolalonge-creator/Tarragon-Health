"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseLagosLocal } from "@/lib/clinical/lagos-local";

export type RecordClinicBpState = { error?: string; success?: boolean } | undefined;

/** Same limits the platform already enforces for a blood pressure reading (pathway TH-CP-HTN-001 section 5.4): 60-260 over 30-160, systolic above diastolic. */
const schema = z
  .object({
    patient_id: z.string().uuid(),
    systolic: z.coerce.number().int().min(60, "Systolic must be between 60 and 260.").max(260, "Systolic must be between 60 and 260."),
    diastolic: z.coerce.number().int().min(30, "Diastolic must be between 30 and 160.").max(160, "Diastolic must be between 30 and 160."),
    measured_at: z.string().min(1, "Enter when it was measured."),
    note: z.string().max(200, "Keep the note under 200 characters.").optional(),
  })
  .refine((v) => v.systolic > v.diastolic, { message: "Systolic must be higher than diastolic.", path: ["systolic"] });

/**
 * A care-team clinic reading (S07x). It goes to its own table, never to the patient's home log, so it raises no home alert. The database checks that the
 * clinician is tied to the patient. It is never shown to the patient and the pattern rule it may feed is clinician-only.
 */
export async function recordClinicBp(_prev: RecordClinicBpState, formData: FormData): Promise<RecordClinicBpState> {
  const parsed = schema.safeParse({
    patient_id: String(formData.get("patient_id") ?? ""),
    systolic: formData.get("systolic"),
    diastolic: formData.get("diastolic"),
    measured_at: String(formData.get("measured_at") ?? ""),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const measured = parseLagosLocal(parsed.data.measured_at);
  if (!measured) return { error: "Enter a valid date and time." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_clinic_bp_reading", {
    p_patient: parsed.data.patient_id,
    p_systolic: parsed.data.systolic,
    p_diastolic: parsed.data.diastolic,
    p_measured_at: measured.toISOString(),
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) {
    if (error.code === "42501") return { error: "You can only record a reading for a patient on your care team." };
    if (error.code === "22023") return { error: "That reading or time is not usable. Check the numbers and the date." };
    return { error: "That did not work. Please try again." };
  }
  revalidatePath(`/clinician/patients/${parsed.data.patient_id}`);
  return { success: true };
}
