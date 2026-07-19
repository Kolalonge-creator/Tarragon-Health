"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ReviewState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  reviewId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Complete a lifestyle review. Clinical-staff gated; reviewed_by is
 * server-stamped by the DB trigger from the caller's clinical_staff row
 * (never client-supplied). Completing rolls the next review at the cadence.
 */
export async function completeReview(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };

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
    return { error: "Only a Tarragon care-team doctor can complete a review" };
  }

  const { error } = await supabase
    .from("lpe_reviews")
    .update({ status: "completed", notes: parsed.data.notes ?? null })
    .eq("id", parsed.data.reviewId)
    .eq("status", "pending");

  if (error) return { error: "Could not complete this review" };

  revalidatePath("/clinician/lifestyle-reviews");
  return { success: true };
}
