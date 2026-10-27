"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignHomeCardConfigState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed every number." }),
});

/**
 * The Chief Medical Officer signs the Today screen configuration. The database checks the role. Signing is what makes the new cards, the streak card,
 * the weekly summary and the readiness line appear at all; the limit of two primary actions is fixed in the database and in code, not in this signature.
 */
export async function signHomeCardConfig(_prev: SignHomeCardConfigState, formData: FormData): Promise<SignHomeCardConfigState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "home_card_config", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_home_card_config", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/home-card-config");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
