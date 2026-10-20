"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignObservationLimitsState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed the limits." }),
});

/** The Chief Medical Officer signs the plausibility limits (S47a, OQ-S47A-1). The database checks the role. Signing never switches extended_observations on. */
export async function signObservationLimits(_prev: SignObservationLimitsState, formData: FormData): Promise<SignObservationLimitsState> {
  const parsed = schema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "observation_limit_signoffs", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_observation_limits", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? "Only the Chief Medical Officer can sign this." : "That did not work. Please try again." };
  revalidatePath("/clinician/observation-limits");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
