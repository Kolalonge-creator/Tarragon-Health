"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignLowCarbConfigState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed every number and exclusion." }),
});

/**
 * The Chief Medical Officer signs the low-carbohydrate programme rules (S50b, S50-2). The database checks the role. Signing does NOT switch the
 * programme on: the go-live guard also needs a signed diabetes step table, a recorded doctor and dietitian rota, and a ketone-testing cost decision.
 */
export async function signLowCarbProtocolConfig(_prev: SignLowCarbConfigState, formData: FormData): Promise<SignLowCarbConfigState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "lowcarb_protocol_config", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_lowcarb_protocol_config", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/lowcarb-protocol-config");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
