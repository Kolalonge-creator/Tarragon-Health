"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type OutsideRecordDecisionResult = { error?: string; success?: boolean; status?: "verified" | "not_verified" };

const decisionSchema = z
  .object({
    documentId: z.string().uuid(),
    outcome: z.enum(["verified", "not_verified"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.outcome === "verified" || (v.note !== undefined && v.note.length > 0), { message: "reason", path: ["note"] });

/**
 * A clinical-tier doctor decides on a record a patient supplied from another hospital (S09y). The database function is the whole gate: care tie,
 * clinical tier, once only, reviewed_by and reviewed_at taken from the session and the clock, and the check audited. Nothing here is copied into the
 * clinical record, whichever way the doctor decides; "verified" only changes what the file is labelled and who is named as having checked it.
 */
export async function decideOutsideRecordAction(input: unknown): Promise<OutsideRecordDecisionResult> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.path[0] === "note" ? "Say briefly why this could not be checked." : "That could not be saved." };
  }
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_outside_record", {
    p_document: parsed.data.documentId,
    p_outcome: parsed.data.outcome,
    p_note: parsed.data.note ?? undefined,
  });
  if (error) {
    if (error.message.includes("already been checked")) return { error: "Someone has already checked this record." };
    if (error.message.includes("not authorised")) return { error: "Only a care-team doctor can check an outside record." };
    return { error: "That could not be saved. Please try again." };
  }
  // The function returns (rather than raises) a refusal for a doctor who is not on this patient's care team, so that its audit row is kept.
  const status = (data as { status?: string } | null)?.status;
  if (status === "refused") return { error: "You are not on this patient's care team, so you cannot check this record. The attempt was logged." };
  if (status !== "verified" && status !== "not_verified") return { error: "That could not be saved. Please try again." };

  revalidatePath("/clinician/worklists");
  revalidatePath(`/clinician/outside-records/${parsed.data.documentId}`);
  return { success: true, status };
}
