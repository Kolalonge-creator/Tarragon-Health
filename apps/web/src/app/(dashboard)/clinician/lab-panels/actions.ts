"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignLabPanelsState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed every range and limit." }),
});

/**
 * Why the database refused the signature. A message the sign_lab_panels function or a
 * guard trigger raised on purpose (SQLSTATE P0001) is written to be read, so it is
 * shown as it is. Anything else (a network or permission failure) stays generic for
 * the person, and is logged so the next failure leaves a trace.
 */
function signErrorMessage(error: { message: string; code?: string }): string {
  if (error.message.includes("not authorised")) return "Only the Chief Medical Officer can sign this.";
  if (error.code === "P0001" && error.message.trim()) return error.message;
  console.error("sign_lab_panels failed", { code: error.code, message: error.message });
  return "That did not work. Please try again.";
}

/** The Chief Medical Officer signs the lab ranges, critical limits and disclosure policy. The database checks the role. */
export async function signLabPanels(_prev: SignLabPanelsState, formData: FormData): Promise<SignLabPanelsState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "lab_panel_signoffs", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_lab_panels", { p_id: parsed.data.id });
  if (error) return { error: signErrorMessage(error) };
  revalidatePath("/clinician/lab-panels");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
