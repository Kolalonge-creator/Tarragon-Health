"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type WomensHealthStaffActionState = { error?: string; success?: boolean } | undefined;

const updateFertilityStatusSchema = z.object({
  status: z.enum(["requested", "education_provided", "consult_booked", "referred", "closed"]),
});

/**
 * Staff-only progression of a fertility_assessment_requests row (§44.13).
 * RLS already restricts the update to org staff (fertility_assessment_
 * requests_update policy) -- this action is just the UI-facing wrapper, same
 * shape as other clinician-side single-field updates in this directory
 * (e.g. mark-result-reviewed.tsx's action).
 */
export async function updateFertilityRequestStatus(
  requestId: string,
  _prev: WomensHealthStaffActionState,
  formData: FormData
): Promise<WomensHealthStaffActionState> {
  const parsed = updateFertilityStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) return { error: "Invalid status" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("fertility_assessment_requests")
    .update({ status: parsed.data.status })
    .eq("id", requestId);
  if (error) return { error: error.message };
  return { success: true };
}
