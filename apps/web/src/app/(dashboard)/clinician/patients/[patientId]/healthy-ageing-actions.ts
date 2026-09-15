"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import type { TablesUpdate } from "@tarragon/shared";

type ActionState = { error?: string; success?: boolean } | undefined;

/**
 * Reads/writes here rely entirely on RLS (org-staff-only update policies on
 * all four tables) for authorisation — nothing here grants a privilege the
 * database wouldn't already allow. The `isClinicalTier` checks below are
 * purely about which control RENDERS for which staff member (falls-pathway
 * progression and clinical review are clinical judgment; social-determinant
 * follow-up and home-visit logistics are Care Coordinator-appropriate
 * booking/navigation work, matching the Clinical Tier Ladder's own split).
 */

export async function reviewAgeingAssessmentDomain(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({ domain_result_id: z.string().uuid(), notes: z.string().trim().max(500).optional() })
    .safeParse({
      domain_result_id: formData.get("domain_result_id"),
      notes: formData.get("notes") || undefined,
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const staff = await getCurrentClinicalStaff();
  if (!isClinicalTier(staff)) return { error: "Only clinical staff may record a review" };

  const supabase = await createClient();
  const update: TablesUpdate<"ageing_assessment_domain_results"> = {
    clinician_reviewed_by: user.id,
    clinician_reviewed_at: new Date().toISOString(),
    notes: parsed.data.notes ?? null,
  };
  const { error } = await supabase
    .from("ageing_assessment_domain_results")
    .update(update)
    .eq("id", parsed.data.domain_result_id);
  if (error) return { error: error.message };

  revalidatePath("/clinician/patients/[patientId]", "page");
  return { success: true };
}

const fallsPathwaySchema = z.object({
  falls_risk_id: z.string().uuid(),
  pathway_stage: z.enum(["risk_identified", "clinical_assessment", "intervention", "follow_up", "resolved"]),
  intervention_notes: z.string().trim().max(500).optional(),
  follow_up_due_at: z.string().optional(),
});

export async function progressFallsRiskPathway(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = fallsPathwaySchema.safeParse({
    falls_risk_id: formData.get("falls_risk_id"),
    pathway_stage: formData.get("pathway_stage"),
    intervention_notes: formData.get("intervention_notes") || undefined,
    follow_up_due_at: formData.get("follow_up_due_at") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { falls_risk_id, pathway_stage, intervention_notes, follow_up_due_at } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const staff = await getCurrentClinicalStaff();
  if (!isClinicalTier(staff)) return { error: "Only clinical staff may progress the falls-risk pathway" };

  const supabase = await createClient();
  const update: TablesUpdate<"falls_risk_assessments"> = { pathway_stage };
  if (pathway_stage === "clinical_assessment") {
    update.assessed_by = user.id;
    update.assessed_at = new Date().toISOString();
  }
  if (pathway_stage === "intervention") {
    update.intervention_notes = intervention_notes ?? null;
    update.intervention_started_at = new Date().toISOString();
  }
  if (pathway_stage === "follow_up") {
    update.follow_up_due_at = follow_up_due_at ?? null;
  }
  if (pathway_stage === "resolved") {
    update.follow_up_completed_at = new Date().toISOString();
    update.resolved_at = new Date().toISOString();
  }

  const { error } = await supabase.from("falls_risk_assessments").update(update).eq("id", falls_risk_id);
  if (error) return { error: error.message };

  revalidatePath("/clinician/patients/[patientId]", "page");
  return { success: true };
}

const socialFollowUpSchema = z.object({
  screening_id: z.string().uuid(),
  follow_up_status: z.enum(["none_needed", "pending", "contacted", "resolved"]),
  coordinator_notes: z.string().trim().max(500).optional(),
});

export async function updateSocialDeterminantFollowUp(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = socialFollowUpSchema.safeParse({
    screening_id: formData.get("screening_id"),
    follow_up_status: formData.get("follow_up_status"),
    coordinator_notes: formData.get("coordinator_notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const update: TablesUpdate<"social_determinant_screenings"> = {
    follow_up_status: parsed.data.follow_up_status,
    coordinator_notes: parsed.data.coordinator_notes ?? null,
    followed_up_by: user.id,
    followed_up_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("social_determinant_screenings")
    .update(update)
    .eq("id", parsed.data.screening_id);
  if (error) return { error: error.message };

  revalidatePath("/clinician/patients/[patientId]", "page");
  return { success: true };
}

const homeCareUpdateSchema = z.object({
  request_id: z.string().uuid(),
  status: z.enum(["eligibility_pending", "eligible", "ineligible", "scheduled", "visit_completed", "declined"]),
  eligibility_notes: z.string().trim().max(500).optional(),
  scheduled_at: z.string().optional(),
  visit_notes: z.string().trim().max(500).optional(),
});

export async function updateHomeCareRequest(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = homeCareUpdateSchema.safeParse({
    request_id: formData.get("request_id"),
    status: formData.get("status"),
    eligibility_notes: formData.get("eligibility_notes") || undefined,
    scheduled_at: formData.get("scheduled_at") || undefined,
    visit_notes: formData.get("visit_notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { request_id, status, eligibility_notes, scheduled_at, visit_notes } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const update: TablesUpdate<"home_care_requests"> = { status };
  if (status === "eligible" || status === "ineligible") {
    update.eligibility_checked_by = user.id;
    update.eligibility_checked_at = new Date().toISOString();
    update.eligibility_notes = eligibility_notes ?? null;
  }
  if (status === "scheduled") {
    update.scheduled_at = scheduled_at ?? null;
  }
  if (status === "visit_completed") {
    update.visit_completed_at = new Date().toISOString();
    update.visit_notes = visit_notes ?? null;
  }

  const { error } = await supabase.from("home_care_requests").update(update).eq("id", request_id);
  if (error) return { error: error.message };

  revalidatePath("/clinician/patients/[patientId]", "page");
  return { success: true };
}
