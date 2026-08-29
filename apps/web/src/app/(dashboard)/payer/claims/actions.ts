"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const schema = z.object({
  claimId: z.string().uuid(),
  status: z.enum(["approved", "partially_approved", "denied", "paid"]),
  claimReference: z.string().trim().max(100).optional(),
  insurerCoveredKobo: z.coerce.number().int().min(0).optional(),
  denialReason: z.string().trim().max(500).optional(),
});

export async function adjudicateClaimAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({
    claimId: formData.get("claimId"),
    status: formData.get("status"),
    claimReference: formData.get("claimReference") || undefined,
    insurerCoveredKobo: formData.get("insurerCoveredKobo") || undefined,
    denialReason: formData.get("denialReason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("payer_adjudicate_claim", {
    p_claim_id: parsed.data.claimId,
    p_status: parsed.data.status,
    p_claim_reference: parsed.data.claimReference ?? undefined,
    p_insurer_covered_kobo: parsed.data.insurerCoveredKobo ?? undefined,
    p_denial_reason: parsed.data.denialReason ?? undefined,
  });
  if (error) return { error: error.message };

  revalidatePath("/payer/claims");
  return { message: `Claim marked ${parsed.data.status}.` };
}
