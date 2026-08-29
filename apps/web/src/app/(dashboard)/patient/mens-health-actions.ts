"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  edAssessmentSchema,
  prostateSymptomAssessmentSchema,
  maleFertilityAssessmentSchema,
} from "@/lib/validation/mens-health";
import { scoreEdAssessment } from "@/lib/rules/ed-assessment-scoring";
import { scoreProstateSymptoms, psaConversationSuggested } from "@/lib/rules/prostate-symptom-scoring";
import { assessMaleFertility, type MaleFertilityRiskFactor } from "@/lib/rules/male-fertility-assessment";
import type { Json } from "@tarragon/shared";

export type MensHealthActionState = { error?: string; success?: boolean } | undefined;

/**
 * Records an erectile dysfunction self-assessment (Men's Health §45.5:
 * "structured assessment -> risk screening -> clinical consultation").
 * Scored here (never trusting the client) and written to
 * erectile_dysfunction_assessments via the service role, mirroring
 * submitMentalHealthScreen. A non-'none' band raises a routine
 * clinician_alerts row via the table's own AFTER INSERT trigger — the
 * "clinical consultation" step happens through the existing escalations
 * queue, not here.
 */
export async function submitEdAssessment(
  _prevState: MensHealthActionState,
  formData: FormData
): Promise<MensHealthActionState> {
  const parsed = edAssessmentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please answer every question" };
  }
  const answers = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const items = Array.from({ length: 5 }, (_, i) => answers[`ed_${i + 1}` as keyof typeof answers]);
  const result = scoreEdAssessment(items);

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("erectile_dysfunction_assessments").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    total_score: result.total,
    severity_band: result.band,
    cardiometabolic_review_suggested: result.cardiometabolicReviewSuggested,
    item_responses: { items } as Json,
  });
  if (insertError) return { error: insertError.message };

  return { success: true };
}

/**
 * Records a prostate urinary symptom self-assessment (IPSS) plus the
 * age/family-history-only PSA-conversation prompt (Men's Health §45.7 — never
 * an automatic PSA order, see prostate-symptom-scoring.ts's own header).
 */
export async function submitProstateSymptomAssessment(
  _prevState: MensHealthActionState,
  formData: FormData
): Promise<MensHealthActionState> {
  const parsed = prostateSymptomAssessmentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please answer every question" };
  }
  const answers = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, date_of_birth")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const items = Array.from(
    { length: 7 },
    (_, i) => answers[`ipss_${i + 1}` as keyof typeof answers] as unknown as number
  );
  const result = scoreProstateSymptoms(items);

  const ageYears = profile.date_of_birth
    ? Math.floor(
        (Date.now() - new Date(profile.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      )
    : null;
  const suggestPsaConversation = psaConversationSuggested(
    ageYears,
    answers.family_history_prostate_cancer
  );

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("prostate_symptom_assessments").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    total_score: result.total,
    severity_band: result.band,
    psa_conversation_suggested: suggestPsaConversation,
    item_responses: {
      items,
      family_history_prostate_cancer: answers.family_history_prostate_cancer,
    } as Json,
  });
  if (insertError) return { error: insertError.message };

  return { success: true };
}

/**
 * Records a male fertility intake (Men's Health §45.6). A suggested semen
 * analysis raises a routine clinician_alerts row via the table's own AFTER
 * INSERT trigger, prompting the care team toward the "investigations ->
 * specialist referral" steps — the actual specialist_referrals row remains a
 * staff action (that table's RLS is staff-write-only), not created here.
 */
export async function submitMaleFertilityAssessment(
  _prevState: MensHealthActionState,
  formData: FormData
): Promise<MensHealthActionState> {
  const raw = {
    trying_to_conceive_months: formData.get("trying_to_conceive_months"),
    risk_factors: formData.getAll("risk_factors"),
    prior_semen_analysis: formData.get("prior_semen_analysis") ?? undefined,
  };
  const parsed = maleFertilityAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please complete the form" };
  }
  const answers = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const result = assessMaleFertility({
    tryingToConceiveMonths: answers.trying_to_conceive_months,
    riskFactors: answers.risk_factors as MaleFertilityRiskFactor[],
    priorSemenAnalysis: answers.prior_semen_analysis,
  });

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("male_fertility_assessments").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    trying_to_conceive_months: answers.trying_to_conceive_months,
    risk_factors: answers.risk_factors as Json,
    prior_semen_analysis: answers.prior_semen_analysis,
    semen_analysis_suggested: result.semenAnalysisSuggested,
  });
  if (insertError) return { error: insertError.message };

  return { success: true };
}
