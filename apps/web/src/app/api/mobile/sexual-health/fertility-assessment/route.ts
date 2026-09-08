import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { KNOWN_RISK_FACTORS } from "@/lib/validation/fertility-assessment";
import { recommendFertilityAction } from "@/lib/rules/fertility-assessment";
import { ageFromDateOfBirth, type Json } from "@tarragon/shared";

/**
 * Mobile equivalent of apps/web/.../patient/sexual-health/fertility-actions.ts's
 * submitFertilityAssessment. Age is read from the caller's own profile —
 * never taken from the request body — and the recommendation is computed
 * here, never trusting a client-supplied action. fertility_assessments has
 * no client-facing INSERT policy at all, and a 'specialist_referral'
 * outcome opens a real specialist_referrals row (always staff/trigger-
 * created, never patient-writable) — both must go through this service-role
 * path.
 */
const bodySchema = z.object({
  trying_duration_months: z.coerce.number().int().min(0).max(120),
  menstrual_cycle_regular: z.boolean().optional(),
  known_risk_factors: z.array(z.enum(KNOWN_RISK_FACTORS)).default([]),
});

export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please check your answers" }, { status: 400 });
  }
  const answers = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, date_of_birth, sex")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

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
    if (referralError) return NextResponse.json({ error: referralError.message }, { status: 400 });
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
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, recommendedAction });
}
