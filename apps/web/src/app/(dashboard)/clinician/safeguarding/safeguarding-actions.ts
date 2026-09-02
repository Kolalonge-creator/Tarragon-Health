"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const resolveSchema = z.object({
  concernId: z.string().uuid(),
  status: z.enum(["under_review", "closed"]),
  reviewOutcome: z.string().max(2000).optional(),
  correctiveAction: z.string().max(2000).optional(),
});

export type ResolveSafeguardingConcernState = { error?: string; success?: boolean } | undefined;

/**
 * Advances a safeguarding_concerns row (the table shipped in
 * 20260829212949_safeguarding_concerns.sql, PR #378). RLS admits any org
 * staff to UPDATE; the actual review/close authority gate (Tier 3+ or
 * Clinical Director — that table's threshold, one rung above emergency-
 * escalation) is enforced by the DB trigger
 * private.enforce_safeguarding_concern_attribution for EVERY status
 * transition, not just closing — this action surfaces that error message
 * rather than duplicating the tier check client-side.
 */
export async function resolveSafeguardingConcern(
  _prevState: ResolveSafeguardingConcernState,
  formData: FormData
): Promise<ResolveSafeguardingConcernState> {
  const parsed = resolveSchema.safeParse({
    concernId: formData.get("concernId"),
    status: formData.get("status"),
    reviewOutcome: formData.get("reviewOutcome") || undefined,
    correctiveAction: formData.get("correctiveAction") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (parsed.data.status === "closed" && !parsed.data.reviewOutcome) {
    return { error: "Closing a concern requires a stated review outcome." };
  }

  // reviewed_by_staff/closed_by_staff/reviewed_at/closed_at are all stamped
  // server-side by enforce_safeguarding_concern_attribution — never sent
  // from the client.
  const { error } = await supabase
    .from("safeguarding_concerns")
    .update({
      status: parsed.data.status,
      ...(parsed.data.reviewOutcome ? { review_outcome: parsed.data.reviewOutcome } : {}),
      ...(parsed.data.correctiveAction ? { corrective_action: parsed.data.correctiveAction } : {}),
    })
    .eq("id", parsed.data.concernId);

  if (error) return { error: error.message };

  revalidatePath("/clinician/safeguarding");
  return { success: true };
}
