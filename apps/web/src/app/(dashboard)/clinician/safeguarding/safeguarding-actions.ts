"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const resolveSchema = z.object({
  concernId: z.string().uuid(),
  // Omitted entirely for a note-only update that leaves status unchanged
  // (any org staff, per safeguarding_concerns_update's broad RLS and the
  // trigger's non-status-change fast path). "under_review"/"closed" are the
  // only two transitions this table's status check constraint allows beyond
  // 'open' — see 20260829213100_safeguarding_concerns.sql.
  status: z.enum(["under_review", "closed"]).optional(),
  reviewOutcome: z.string().max(2000).optional(),
  correctiveAction: z.string().max(2000).optional(),
});

export type ResolveSafeguardingConcernState = { error?: string; success?: boolean } | undefined;

/**
 * Updates a safeguarding_concerns row — the shared Patient Safety table
 * (see 20260902204423_extend_safeguarding_concerns_adolescent_linkage.sql
 * for why this module unifies onto it rather than a table of its own). RLS
 * admits any org staff to UPDATE; the real enforcement boundary is the DB
 * trigger private.enforce_safeguarding_concern_attribution, which — per its
 * live definition — requires Tier 3+/Clinical Director for ANY status
 * transition (moving into under_review needs the same authority as
 * closing, not just closing), but leaves a non-status-changing edit
 * (adding a review_outcome/corrective_action note while status stays the
 * same) open to any org staff. This action surfaces the trigger's own error
 * message on an authority failure rather than duplicating the tier check
 * client-side, same as how the escalation worklist relies on
 * enforce_emergency_escalation_tier. reviewed_by_staff/reviewed_at/
 * closed_by_staff/closed_at are stamped by the trigger from the session
 * itself — this action never sets them directly.
 */
export async function resolveSafeguardingConcern(
  _prevState: ResolveSafeguardingConcernState,
  formData: FormData
): Promise<ResolveSafeguardingConcernState> {
  const parsed = resolveSchema.safeParse({
    concernId: formData.get("concernId"),
    status: formData.get("status") || undefined,
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
  if (!parsed.data.status && !parsed.data.reviewOutcome && !parsed.data.correctiveAction) {
    return { error: "Nothing to save." };
  }

  const { error } = await supabase
    .from("safeguarding_concerns")
    .update({
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.reviewOutcome ? { review_outcome: parsed.data.reviewOutcome } : {}),
      ...(parsed.data.correctiveAction ? { corrective_action: parsed.data.correctiveAction } : {}),
    })
    .eq("id", parsed.data.concernId);

  if (error) return { error: error.message };

  revalidatePath("/clinician/safeguarding");
  return { success: true };
}
