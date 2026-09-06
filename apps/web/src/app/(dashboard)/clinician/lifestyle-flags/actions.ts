"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";

export type StandDownState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  flagId: z.string().uuid(),
  reason: z.string().trim().min(4, "Add a short reason"),
});

/**
 * Stand down an LPE red flag. Clinical judgement, so it is gated on
 * isClinicalTier, not a bare "has an active clinical_staff row" check — a
 * Care Coordinator has one of those too (see lifestyle-reviews/actions.ts).
 * `stood_down_by` is server-derived from the caller's clinical_staff row —
 * never client-supplied, the same forge-proof rule as ReviewedByDoctor. The
 * DB trigger (private.enforce_lpe_red_flag_stand_down) only enforces that an
 * actor + reason are present and stamps the time — it does not itself check
 * clinical tier, so this app-layer check is the real enforcement boundary.
 */
export async function standDownFlag(
  _prev: StandDownState,
  formData: FormData,
): Promise<StandDownState> {
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id, doctor_tier, is_clinical_director")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff || !isClinicalTier(staff)) {
    return { error: "Only a Tarragon care-team doctor can stand down a safety flag" };
  }

  const { error } = await supabase
    .from("lpe_red_flag_events")
    .update({
      status: "stood_down",
      stood_down_by: staff.id,
      stood_down_reason: parsed.data.reason,
    })
    .eq("id", parsed.data.flagId)
    .eq("status", "open");

  if (error) return { error: "Could not stand down this flag" };

  revalidatePath("/clinician/lifestyle-flags");
  return { success: true };
}
