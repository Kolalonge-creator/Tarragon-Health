"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type CompleteChronicProgrammeReviewState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  summary: z.string().trim().min(1, "Add a short summary of the 12-week trend").max(4000),
});

/**
 * Signs off the 12-week programme-end review — a thin orchestration record
 * (chronic_programme_end_reviews), not a new trend-computation engine (see
 * that table's own migration header, following CLAUDE.md's "never rebuild
 * the Annual Health Review as a parallel record" rule). Same
 * server-derived-attribution pattern as completeHealthCheckReview:
 * reviewed_by is resolved from the caller's own clinical_staff row, never
 * trusted from the client.
 */
export async function completeChronicProgrammeReview(
  reviewId: string,
  _prevState: CompleteChronicProgrammeReviewState,
  formData: FormData
): Promise<CompleteChronicProgrammeReviewState> {
  const parsed = schema.safeParse({ summary: formData.get("summary") });
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
    return { error: "Only an active Tarragon care-team doctor can sign off a programme review" };
  }

  const { error } = await supabase
    .from("chronic_programme_end_reviews")
    .update({
      reviewed_by: staff.id,
      reviewed_at: new Date().toISOString(),
      summary: parsed.data.summary,
    })
    .eq("id", reviewId);
  if (error) return { error: error.message };

  return { success: true };
}
