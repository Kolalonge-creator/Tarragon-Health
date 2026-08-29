"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const resolveSchema = z.object({
  concernId: z.string().uuid(),
  status: z.enum(["under_review", "escalated_external", "resolved", "closed_no_action"]),
  resolutionNotes: z.string().max(2000).optional(),
});

export type ResolveSafeguardingConcernState = { error?: string; success?: boolean } | undefined;

/**
 * Advances a safeguarding_concerns row. RLS admits any org staff to UPDATE;
 * the actual resolve/close authority gate (Tier 2+ or Clinical Director) is
 * enforced by the DB trigger private.enforce_safeguarding_concern_resolution_
 * tier — this action surfaces that error message rather than duplicating the
 * tier check client-side, same as how the escalation worklist relies on
 * enforce_emergency_escalation_tier.
 */
export async function resolveSafeguardingConcern(
  _prevState: ResolveSafeguardingConcernState,
  formData: FormData
): Promise<ResolveSafeguardingConcernState> {
  const parsed = resolveSchema.safeParse({
    concernId: formData.get("concernId"),
    status: formData.get("status"),
    resolutionNotes: formData.get("resolutionNotes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const isClosing = parsed.data.status === "resolved" || parsed.data.status === "closed_no_action";
  if (isClosing && !parsed.data.resolutionNotes) {
    return { error: "Resolving or closing a concern requires a resolution note." };
  }

  // resolved_by is a clinical_staff.id FK, not the profile id — the caller's
  // own active clinical_staff row must be looked up first.
  let resolvedByStaffId: string | null = null;
  if (isClosing) {
    const { data: staff } = await supabase
      .from("clinical_staff")
      .select("id")
      .eq("profile_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (!staff) return { error: "No active clinical staff record on file for this account." };
    resolvedByStaffId = staff.id;
  }

  const { error } = await supabase
    .from("safeguarding_concerns")
    .update({
      status: parsed.data.status,
      ...(isClosing
        ? { resolved_by: resolvedByStaffId, resolved_at: new Date().toISOString(), resolution_notes: parsed.data.resolutionNotes }
        : {}),
    })
    .eq("id", parsed.data.concernId);

  if (error) return { error: error.message };

  revalidatePath("/clinician/safeguarding");
  return { success: true };
}
