import { NextResponse } from "next/server";
import { hasScope, verifyApiKey } from "@/lib/integrations/api-key";
import { checkProtocolApiQuota } from "@/lib/protocol-api/check-quota";
import { logProtocolApiUsage } from "@/lib/protocol-api/log-usage";
import { cvRiskSchema } from "@/lib/validation/protocol-api";
import { assessCvRisk, PROVISIONAL_CV_RISK_CONFIG } from "@/lib/rules/cv-risk";

/**
 * Stateless cardiovascular-risk stratification classifier -- the third
 * Protocol API endpoint. Wraps assessCvRisk verbatim, running on
 * PROVISIONAL_CV_RISK_CONFIG (the same honestly-labelled provisional
 * defaults this platform itself falls back to when no Medical-Director-
 * signed config is in force -- see cv-risk.ts's own docstring). A partner
 * never sees Tarragon's live signed cv_risk_config (that's internal
 * clinical governance data specific to this platform's own patients);
 * `config_signed` is always false in this response, honestly.
 *
 * The engine's own two hard rules apply unchanged here: it never
 * prescribes, and primary prevention is framed as a lifestyle-first
 * conversation, never an automatic trigger -- a partner integrating this
 * inherits those guardrails structurally, not by convention.
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

  const parsed = cvRiskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  logProtocolApiUsage(verified, "cv-risk");

  const d = parsed.data;
  const assessment = assessCvRisk(
    {
      age: d.age,
      sex: d.sex,
      ldlMgDl: d.ldl_mg_dl,
      nonHdlMgDl: d.non_hdl_mg_dl,
      previousNonHdlMgDl: d.previous_non_hdl_mg_dl,
      tenYearRiskPct: d.ten_year_risk_pct,
      tenYearRiskLevel: d.ten_year_risk_level,
      diabetes: d.diabetes,
      cvProfile: d.cv_profile,
      onLipidLoweringTherapy: d.on_lipid_lowering_therapy,
    },
    PROVISIONAL_CV_RISK_CONFIG,
    { configSigned: false }
  );

  return NextResponse.json({
    prevention_category: assessment.preventionCategory,
    risk_category: assessment.riskCategory,
    ldl_target_mg_dl: assessment.ldlTargetMgDl,
    non_hdl_target_mg_dl: assessment.nonHdlTargetMgDl,
    at_target: assessment.atTarget,
    statin_recommendation: assessment.statinRecommendation,
    escalations: assessment.escalations,
    config_signed: assessment.configSigned,
    population_note: assessment.populationNote,
    rationale: assessment.rationale,
    advisory: true,
    disclaimer:
      "Advisory risk stratification only, never a prescription -- this engine never recommends a specific medication or dose, and a high-risk/secondary-prevention classification always means 'flag for clinician review', never 'treat automatically'.",
  });
}
