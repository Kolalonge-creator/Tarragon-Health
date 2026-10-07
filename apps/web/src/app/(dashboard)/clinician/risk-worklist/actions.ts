"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  patientId: z.string().uuid(),
  level: z.enum(["low", "medium", "high"]),
  reason: z.string().trim().min(10).max(500),
  days: z.coerce.number().int().min(1).max(30),
});

/**
 * A clinician's override of where a patient sits on their worklist. The database re-checks everything (a tie to the patient, a written
 * reason, the maximum number of days) and writes the audit row; this only shapes the input. The computed score is never changed.
 */
export async function overrideRiskAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    patientId: formData.get("patientId"),
    level: formData.get("level"),
    reason: formData.get("reason"),
    days: formData.get("days"),
  });
  if (!parsed.success) redirect("/clinician/risk-worklist?override=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("override_patient_risk", {
    p_patient: parsed.data.patientId,
    p_level: parsed.data.level,
    p_reason: parsed.data.reason,
    p_days: parsed.data.days,
  });
  // A refusal comes back as a status (so its audit row is kept), not as an error.
  const status = typeof data === "object" && data !== null && "status" in data ? data.status : null;
  if (error || status !== "ok") redirect("/clinician/risk-worklist?override=refused");
  revalidatePath("/clinician/risk-worklist");
  redirect("/clinician/risk-worklist?override=done");
}
