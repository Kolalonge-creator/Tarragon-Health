"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignNutritionTargetsConfigState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed every number." }),
});

/**
 * The Chief Medical Officer signs the nutrition targets and meal summary configuration. The database checks the role. Signing is what makes targets
 * appear for patients at all; the withholding rules (pregnancy, postnatal year, clinician hold, eating-disorder screen, under 18) stay in force.
 */
export async function signNutritionTargetsConfig(_prev: SignNutritionTargetsConfigState, formData: FormData): Promise<SignNutritionTargetsConfigState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "nutrition_target_config", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_nutrition_target_config", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/nutrition-targets-config");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
