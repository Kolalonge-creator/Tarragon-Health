"use server";

import { createClient } from "@/lib/supabase/server";

export type RecommendationActionResult = { error?: string; success?: boolean };

/**
 * Promote a care-programme recommendation into a real care_plans row. The
 * care plan is authored by the acting clinician (assigned_clinician_id = the
 * caller) and starts as a `draft` for them to review/adjust — it is not
 * auto-activated, and the recommendation carries no doctor-review claim of
 * its own. All writes run under the clinician's own RLS-scoped session
 * (care_plans insert + recommendation update both require org staff).
 */
export async function acceptRecommendation(
  recommendationId: string,
): Promise<RecommendationActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: rec, error: recError } = await supabase
    .from("care_plan_recommendations")
    .select("id, organisation_id, patient_id, condition, status")
    .eq("id", recommendationId)
    .single();
  if (recError || !rec) {
    return { error: "Recommendation not found" };
  }
  if (rec.status !== "proposed") {
    return { error: "This recommendation has already been actioned" };
  }

  const { data: plan, error: planError } = await supabase
    .from("care_plans")
    .insert({
      organisation_id: rec.organisation_id,
      patient_id: rec.patient_id,
      condition: rec.condition,
      status: "draft",
      assigned_clinician_id: user.id,
      notes: "Created from the patient's onboarding risk recommendation.",
    })
    .select("id")
    .single();
  if (planError || !plan) {
    return { error: planError?.message ?? "Could not create the care plan" };
  }

  const { error: updateError } = await supabase
    .from("care_plan_recommendations")
    .update({
      status: "accepted",
      care_plan_id: plan.id,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", recommendationId);
  if (updateError) {
    return { error: updateError.message };
  }

  return { success: true };
}

/** Dismiss a recommendation the care team judges unnecessary. */
export async function dismissRecommendation(
  recommendationId: string,
): Promise<RecommendationActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { error } = await supabase
    .from("care_plan_recommendations")
    .update({
      status: "dismissed",
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", recommendationId)
    .eq("status", "proposed");
  if (error) {
    return { error: error.message };
  }
  return { success: true };
}
