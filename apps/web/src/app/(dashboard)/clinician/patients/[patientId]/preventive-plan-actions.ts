"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { reviewPreventivePlanSchema } from "@/lib/validation/preventive-plan";

export type ReviewPreventivePlanState = { error?: string; success?: boolean } | undefined;

/**
 * T2 Phase 3: a doctor records the new Member's preventive plan as authorised, or adjusted with a note. The authority (a doctor,
 * never a coordinator; tied to the patient; once only) is enforced by public.review_preventive_plan; the doctor's identity is
 * the session's, never a form field. Adjustments themselves are made first with the existing tools (not applicable, move a date).
 */
export async function reviewPreventivePlan(
  patientId: string,
  _prev: ReviewPreventivePlanState,
  formData: FormData,
): Promise<ReviewPreventivePlanState> {
  const parsed = reviewPreventivePlanSchema.safeParse({
    baseline_id: formData.get("baseline_id"),
    decision: formData.get("decision"),
    note: (formData.get("note") as string | null) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_preventive_plan", {
    p_baseline: parsed.data.baseline_id,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
  });
  if (error) {
    if (error.message.includes("already_reviewed")) return { error: "This plan has already been reviewed." };
    if (error.code === "42501") return { error: "Only a doctor caring for this patient can review the plan." };
    return { error: "The decision was not saved. Please try again." };
  }
  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}
