import { NextResponse } from "next/server";
import { hasScope, verifyApiKey } from "@/lib/integrations/api-key";
import { checkProtocolApiQuota } from "@/lib/protocol-api/check-quota";
import { logProtocolApiUsage } from "@/lib/protocol-api/log-usage";
import { diabetesRiskSchema } from "@/lib/validation/protocol-api";
import { scoreFindrisc } from "@/lib/rules/findrisc";

/**
 * Stateless FINDRISC diabetes-risk classifier (Finnish Diabetes Risk Score,
 * validated in Nigeria per lib/rules/findrisc.ts's own docstring) -- the
 * second Protocol API endpoint. Same pure, standard, point-scored engine
 * this platform's own risk-assessment onboarding step runs.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const verified = await verifyApiKey(request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  }
  if (!hasScope(verified, "protocol_api:classify")) {
    return NextResponse.json({ error: "API key lacks the protocol_api:classify scope" }, { status: 403 });
  }
  const quota = await checkProtocolApiQuota(verified);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: `Monthly quota exceeded (${quota.used}/${quota.limit} calls) — contact your account manager.` },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = diabetesRiskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  logProtocolApiUsage(verified, "diabetes-risk");

  const d = parsed.data;
  const result = scoreFindrisc({
    ageYears: d.age_years,
    bmi: d.bmi,
    waistCm: d.waist_cm,
    sex: d.sex,
    physicallyActive: d.physically_active,
    eatsVegetablesFruitDaily: d.eats_vegetables_fruit_daily,
    onBpMedication: d.on_bp_medication,
    historyOfHighGlucose: d.history_of_high_glucose,
    familyHistory: d.family_history,
  });

  return NextResponse.json({
    score: result.score,
    band: result.band,
    approx_ten_year_risk: result.approxTenYearRisk,
    recommend_blood_test: result.recommendBloodTest,
    advisory: true,
    disclaimer: "Advisory screening guidance only, not a diagnosis -- a moderate-or-higher band should proceed to a diagnostic blood test (FPG or HbA1c).",
  });
}
