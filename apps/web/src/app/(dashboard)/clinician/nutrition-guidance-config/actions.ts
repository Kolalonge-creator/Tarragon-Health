"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignNutritionGuidanceConfigState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed every swap and every plan." }),
});

/**
 * The Chief Medical Officer signs the swap table and the five eating plans. The database checks the role. Signing makes the swaps and plans
 * appear for the patients each one applies to; the withholding rules (pregnancy, postnatal year, clinician hold, eating-disorder screen,
 * under 18) stay in force and are not part of this signature.
 */
export async function signNutritionGuidanceConfig(_prev: SignNutritionGuidanceConfigState, formData: FormData): Promise<SignNutritionGuidanceConfigState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "nutrition_guidance_config", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_nutrition_guidance_config", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/nutrition-guidance-config");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
