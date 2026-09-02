"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const schema = z.object({
  preauthorizationId: z.string().uuid(),
  decision: z.enum(["approved", "denied"]),
  authorizationNumber: z.string().trim().max(100).optional(),
  denialReason: z.string().trim().max(500).optional(),
});

export async function decidePreauthorizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({
    preauthorizationId: formData.get("preauthorizationId"),
    decision: formData.get("decision"),
    authorizationNumber: formData.get("authorizationNumber") || undefined,
    denialReason: formData.get("denialReason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("payer_decide_preauthorization", {
    p_preauthorization_id: parsed.data.preauthorizationId,
    p_decision: parsed.data.decision,
    p_authorization_number: parsed.data.authorizationNumber ?? undefined,
    p_denial_reason: parsed.data.denialReason ?? undefined,
  });
  if (error) return { error: error.message };

  revalidatePath("/payer/preauthorizations");
  return { message: `Marked ${parsed.data.decision}.` };
}
