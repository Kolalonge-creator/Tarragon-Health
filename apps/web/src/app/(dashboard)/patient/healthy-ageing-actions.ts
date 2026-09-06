"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import {
  ageingAssessmentDomainAnswersSchema,
  fallsRiskCheckSchema,
  socialDeterminantsCheckSchema,
  homeCareRequestSchema,
} from "@/lib/validation/healthy-ageing";

type ActionState = { error?: string; success?: boolean } | undefined;

/** Every insert here is on the caller's OWN RLS-scoped Supabase client, never
 * service role — the acting-for/attribution guarantees (logged_by_profile_id,
 * can_act_for) are enforced by the database, not re-implemented here. */
async function currentSubject() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" as const };

  const subjectId = await resolveSubjectId(user.id);
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" as const };

  return { supabase, subjectId, organisationId: profile.organisation_id };
}

/**
 * Finds (or starts) the patient's most recent in-progress ageing assessment
 * and writes the submitted domain answers onto it, upserting so re-answering
 * a domain in the same check-in overwrites rather than duplicates.
 */
export async function submitAgeingAssessmentDomains(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = JSON.parse(String(formData.get("answers_json") ?? "[]"));
  const parsed = ageingAssessmentDomainAnswersSchema.safeParse({ answers: raw });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentSubject();
  if ("error" in ctx) return ctx;
  const { supabase, subjectId, organisationId } = ctx;

  const { data: openAssessment } = await supabase
    .from("ageing_assessments")
    .select("id")
    .eq("patient_id", subjectId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let assessmentId = openAssessment?.id;
  if (!assessmentId) {
    const { data: created, error: createError } = await supabase
      .from("ageing_assessments")
      .insert({ organisation_id: organisationId, patient_id: subjectId })
      .select("id")
      .single();
    if (createError || !created) {
      return { error: createError?.message ?? "Could not start a new check-in" };
    }
    assessmentId = created.id;
  }

  const { error: upsertError } = await supabase
    .from("ageing_assessment_domain_results")
    .upsert(
      parsed.data.answers.map((a) => ({
        assessment_id: assessmentId,
        domain: a.domain,
        outcome: a.outcome,
        notes: a.note ?? null,
      })),
      { onConflict: "assessment_id,domain" },
    );
  if (upsertError) return { error: upsertError.message };

  revalidatePath("/patient/healthy-ageing");
  return { success: true };
}

export async function submitFallsRiskCheck(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = fallsRiskCheckSchema.safeParse({
    previous_falls_12mo: formData.get("previous_falls_12mo") === "on",
    mobility_impairment: formData.get("mobility_impairment") === "on",
    high_risk_medications: formData.get("high_risk_medications") === "on",
    environmental_hazards: formData.get("environmental_hazards") === "on",
    balance_concern: formData.get("balance_concern") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentSubject();
  if ("error" in ctx) return ctx;
  const { supabase, subjectId, organisationId } = ctx;

  const { error } = await supabase.from("falls_risk_assessments").insert({
    organisation_id: organisationId,
    patient_id: subjectId,
    ...parsed.data,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/healthy-ageing");
  return { success: true };
}

export async function submitSocialDeterminantsCheck(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = socialDeterminantsCheckSchema.safeParse({
    living_alone: formData.get("living_alone") === "on",
    transport_difficulty: formData.get("transport_difficulty") === "on",
    financial_barrier: formData.get("financial_barrier") === "on",
    caregiver_limitation: formData.get("caregiver_limitation") === "on",
    healthcare_access_difficulty: formData.get("healthcare_access_difficulty") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentSubject();
  if ("error" in ctx) return ctx;
  const { supabase, subjectId, organisationId } = ctx;

  const { error } = await supabase.from("social_determinant_screenings").insert({
    organisation_id: organisationId,
    patient_id: subjectId,
    ...parsed.data,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/healthy-ageing");
  return { success: true };
}

export async function submitHomeCareRequest(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = homeCareRequestSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentSubject();
  if ("error" in ctx) return ctx;
  const { supabase, subjectId, organisationId } = ctx;

  const { error } = await supabase.from("home_care_requests").insert({
    organisation_id: organisationId,
    patient_id: subjectId,
    reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/healthy-ageing");
  return { success: true };
}
