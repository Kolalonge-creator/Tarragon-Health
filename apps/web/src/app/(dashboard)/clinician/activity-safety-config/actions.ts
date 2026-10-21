"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignActivitySafetyConfigState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed the activity safety rules." }),
});

/**
 * The Chief Medical Officer signs the activity safety rules (S48a). The database checks the role. The gate already enforces these rules as they
 * stand, because it only ever restricts; signing records the CMO's review under their own name and does not switch anything on.
 */
export async function signActivitySafetyConfig(_prev: SignActivitySafetyConfigState, formData: FormData): Promise<SignActivitySafetyConfigState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "activity_safety_config", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_activity_safety_config", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/activity-safety-config");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
