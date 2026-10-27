"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  patientId: z.string().uuid(),
  note: z.string().trim().max(300).optional(),
});

/**
 * A tied clinician makes a follow-up task for a patient on their mental health worklist. The database re-checks everything (a clinician who
 * is not a care coordinator, a tie to the patient, that the patient is on THEIR list, that the signed rules are in force) and writes the audit
 * row; this only shapes the input. A refusal comes back as NULL so the audit row survives, and shows as "refused", never as success.
 */
export async function createMentalHealthFollowUpAction(formData: FormData): Promise<void> {
  const note = formData.get("note");
  const parsed = schema.safeParse({ patientId: formData.get("patientId"), note: typeof note === "string" && note.trim() !== "" ? note : undefined });
  if (!parsed.success) redirect("/clinician/mental-health-worklist?followup=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_mental_health_worklist_follow_up", {
    p_patient: parsed.data.patientId,
    ...(parsed.data.note === undefined ? {} : { p_note: parsed.data.note }),
  });
  if (error || typeof data !== "string" || data === "") redirect("/clinician/mental-health-worklist?followup=refused");
  revalidatePath("/clinician/mental-health-worklist");
  redirect("/clinician/mental-health-worklist?followup=done");
}
