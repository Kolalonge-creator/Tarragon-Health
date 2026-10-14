"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignHomeBpProgrammeState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed every value." }),
});

/** The Chief Medical Officer signs the protocol, the bands and the pattern rule. The database checks the role; nothing here signs on anyone's behalf. */
export async function signHomeBpProgramme(_prev: SignHomeBpProgrammeState, formData: FormData): Promise<SignHomeBpProgrammeState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "home_bp_programme_signoffs", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_home_bp_programme", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/home-bp-programme");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
