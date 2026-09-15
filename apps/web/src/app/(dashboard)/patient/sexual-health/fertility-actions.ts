"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fertilityAssessmentSchema } from "@/lib/validation/fertility-assessment";
import {
  recommendFertilityAction,
  type FertilityRecommendedAction,
} from "@/lib/rules/fertility-assessment";
import { ageFromDateOfBirth } from "@tarragon/shared";
import type { Json } from "@tarragon/shared";

export type SubmitFertilityAssessmentState =
  | { error?: string; success?: boolean; recommendedAction?: FertilityRecommendedAction }
  | undefined;

/**
 * Records a fertility self-assessment (spec §47.9). Age is read from the
 * caller's own profile — never taken from the form — and the recommendation
 * is computed here (recommendFertilityAction), never trusting a
 * client-supplied action. Both fertility_assessments and, when the
 * recommendation is a referral, specialist_referrals are written via the
 * service role: fertility_assessments has no client-facing INSERT policy at
 * all (a 'specialist_referral' outcome opens a real referral row, so the
 * recommendation must never be forgeable), and specialist_referrals is
 * always staff/trigger-created, never patient-writable.
 */
export async function submitFertilityAssessment(
  _prevState: SubmitFertilityAssessmentState,
  formData: FormData
): Promise<SubmitFertilityAssessmentState> {
  const raw = {
    trying_duration_months: formData.get("trying_duration_months"),
    menstrual_cycle_regular: formData.get("menstrual_cycle_regular") ?? undefined,
    known_risk_factors: formData.getAll("known_risk_factors"),
  };
  const parsed = fertilityAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your answers" };
  }
  const answers = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, date_of_birth, sex")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const ageYears = ageFromDateOfBirth(profile.date_of_birth);
  const recommendedAction = recommendFertilityAction({
    tryingDurationMonths: answers.trying_duration_months,
    ageYears,
    knownRiskFactors: answers.known_risk_factors,
  });

  const service = createServiceRoleClient();

  let specialistReferralId: string | null = null;
  if (recommendedAction === "specialist_referral") {
    const { data: referral, error: referralError } = await service
      .from("specialist_referrals")
      .insert({
        organisation_id: profile.organisation_id,
        patient_id: user.id,
        specialist_type: profile.sex === "female" ? "ob_gyn" : "urologist",
        referral_reason: "Fertility assessment recommended specialist review.",
        status: "pending",
        urgency: "routine",
      })
      .select("id")
      .single();
    if (referralError) return { error: referralError.message };
    specialistReferralId = referral.id;
  }

  const { error: insertError } = await service.from("fertility_assessments").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    trying_duration_months: answers.trying_duration_months,
    responses: {
      trying_duration_months: answers.trying_duration_months,
      menstrual_cycle_regular: answers.menstrual_cycle_regular ?? null,
      known_risk_factors: answers.known_risk_factors,
    } as Json,
    recommended_action: recommendedAction,
    specialist_referral_id: specialistReferralId,
  });
  if (insertError) return { error: insertError.message };

  return { success: true, recommendedAction };
}
