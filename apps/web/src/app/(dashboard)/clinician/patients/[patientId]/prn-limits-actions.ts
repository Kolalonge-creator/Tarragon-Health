"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Input = z.object({
  patientId: z.string().uuid(),
  medicationId: z.string().uuid(),
  minGapMinutes: z.number().int().nullable(),
  dailyMax: z.number().int().nullable(),
  reason: z.string().trim().min(10, "Say why, in at least 10 characters.").max(500),
});

export type SetPrnLimitsState = { error?: string; success?: boolean } | undefined;

/**
 * Set (or clear, with both blank) the as-needed limits for one medicine. The database function is the real gate:
 * it needs the signed rule, an active as-needed medicine, prescribing authority and a tie to the patient, checks
 * the signed bounds, and audits the change. Nothing here changes a dose, a medicine or a schedule.
 */
export async function setPrnLimitsAction(_prev: SetPrnLimitsState, formData: FormData): Promise<SetPrnLimitsState> {
  const num = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : Number(v);
  };
  const parsed = Input.safeParse({
    patientId: formData.get("patientId"),
    medicationId: formData.get("medicationId"),
    minGapMinutes: num("minGapMinutes"),
    dailyMax: num("dailyMax"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the values." };
  const { patientId, medicationId, minGapMinutes, dailyMax, reason } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_medication_prn_limits", {
    p_medication: medicationId,
    p_min_gap_minutes: minGapMinutes as number,
    p_daily_max: dailyMax as number,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}
