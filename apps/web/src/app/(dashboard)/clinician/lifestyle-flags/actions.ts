"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type StandDownState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  flagId: z.string().uuid(),
  reason: z.string().trim().min(4, "Add a short reason"),
});

/**
 * Stand down an LPE red flag. Clinical judgement, so it is gated on an active
 * clinical_staff record (a Care Coordinator is excluded). `stood_down_by` is
 * server-derived from the caller's clinical_staff row — never client-supplied,
 * the same forge-proof rule as ReviewedByDoctor. The DB trigger additionally
 * enforces actor + reason and stamps the time; nothing here can auto-close.
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
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) {
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
