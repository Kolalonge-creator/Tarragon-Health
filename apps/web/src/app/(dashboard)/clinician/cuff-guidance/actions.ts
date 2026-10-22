"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignCuffGuidanceState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have checked the sizes against the sources." }),
});

/** The Chief Medical Officer signs the cuff size table. The database checks the role; nothing here signs on anyone's behalf. */
export async function signCuffGuidance(_prev: SignCuffGuidanceState, formData: FormData): Promise<SignCuffGuidanceState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "bp_cuff_guidance_signoffs", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_bp_cuff_guidance", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/cuff-guidance");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
