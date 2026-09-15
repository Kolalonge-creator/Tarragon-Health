import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { stiRiskCheckSchema } from "@/lib/validation/sti-risk-check";
import { scoreStiRiskCheck } from "@/lib/rules/sti-risk-assessment";
import type { Json, TablesInsert } from "@tarragon/shared";

/**
 * Mobile equivalent of apps/web/.../patient/sexual-health/sti-actions.ts's
 * submitStiRiskCheck. sti_risk_checks has no client-facing INSERT policy at
 * all (same tamper-resistance as mental_health_screens) — the score is
 * computed here, never trusting a client-supplied risk level, and a
 * reported symptom or high-risk result raises a clinician_alerts row via
 * the same service-role client, exactly as the web action does.
 */
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

  const parsed = stiRiskCheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please answer every question" }, { status: 400 });
  }
  const answers = parsed.data;

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const { riskLevel, symptomFlag, recommendedScreenCodes } = scoreStiRiskCheck(answers);

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("sti_risk_checks").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    risk_level: riskLevel,
    symptom_flag: symptomFlag,
    recommended_screen_codes: recommendedScreenCodes,
    responses: answers as unknown as Json,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  if (symptomFlag || riskLevel === "high") {
    const alertRow: TablesInsert<"clinician_alerts"> = {
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      level: "clinician_review",
      title: "Sexual health risk check needs a look",
      detail: symptomFlag
        ? `Patient reported a symptom on their sexual health risk check (risk level: ${riskLevel}). Recommended screens: ${recommendedScreenCodes.join(", ")}.`
        : `Patient's sexual health risk check came back high risk with no reported symptoms. Recommended screens: ${recommendedScreenCodes.join(", ")}.`,
      category: "clinical",
      type_code: symptomFlag ? "symptom_escalation" : "abnormal_result",
    };
    await service.from("clinician_alerts").insert(alertRow);
  }

  return NextResponse.json({ success: true, riskLevel, recommendedScreenCodes });
}
