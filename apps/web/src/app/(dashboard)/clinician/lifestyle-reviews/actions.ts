"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";

export type ReviewState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  reviewId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Complete a lifestyle review. reviewed_by is server-stamped by the DB
 * trigger from the caller's clinical_staff row (never client-supplied), and
 * private.stamp_lpe_review_completion is the real enforcement boundary that
 * blocks a non-clinical-tier caller (e.g. a Care Coordinator) outright. This
 * check is only a friendly early refusal so a Care Coordinator sees a clear
 * message instead of a raw Postgres error — it must use isClinicalTier, not
 * a bare "has an active clinical_staff row" check, since a Care Coordinator
 * has one of those too.
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
    .select("doctor_tier")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!isClinicalTier(staff ?? null)) {
    return {
      error:
        "Only a clinical-tier member of the care team can complete a review. A Care Coordinator can prepare it, but a doctor must complete it.",
    };
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
