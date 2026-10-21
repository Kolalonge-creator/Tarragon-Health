"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignLabFallbackState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have read the wording and agree it may be sent." }),
});

/** The Chief Medical Officer signs the wording of the disclosure fallback message. The database checks the role. */
export async function signLabFallbackWording(_prev: SignLabFallbackState, formData: FormData): Promise<SignLabFallbackState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "lab_fallback_wording_signoffs", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await loose(supabase).rpc("sign_lab_fallback_wording", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : error.message.includes("lab_fallback_wording_changed") ? "The message words changed since this version was written. A new version is needed." : "That did not work. Please try again." };
  revalidatePath("/clinician/lab-fallback");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
