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

/** The Chief Medical Officer signs the lab ranges, critical limits and disclosure policy. The database checks the role. */
export async function signLabPanels(_prev: SignLabPanelsState, formData: FormData): Promise<SignLabPanelsState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "lab_panel_signoffs", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_lab_panels", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/lab-panels");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
