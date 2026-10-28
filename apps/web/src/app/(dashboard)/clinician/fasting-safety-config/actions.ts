"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignFastingSafetyConfigState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed the fasting safety rules." }),
});

/**
 * The Chief Medical Officer signs the religious-fasting safety rules (S50b). The database checks the role. Unlike the activity gate this gate can say
 * "may fast with guidance", so the rules do NOT apply until signed: with no signed row every patient gets the single unavailable answer. Signing alone
 * does not show the fasting screen either; the fasting_safety go-live guard is a separate switch.
 */
export async function signFastingSafetyConfig(_prev: SignFastingSafetyConfigState, formData: FormData): Promise<SignFastingSafetyConfigState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "fasting_safety_config", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_fasting_safety_config", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/fasting-safety-config");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
