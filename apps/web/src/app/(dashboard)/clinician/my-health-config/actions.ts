"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignMyHealthConfigState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed the field list." }),
});

/** The Chief Medical Officer signs the lock-screen pass field list (C8). The database checks the role. Signing never switches the wallet guard on. */
export async function signMyHealthConfig(_prev: SignMyHealthConfigState, formData: FormData): Promise<SignMyHealthConfigState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "my_health_config", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_my_health_config", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/my-health-config");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
