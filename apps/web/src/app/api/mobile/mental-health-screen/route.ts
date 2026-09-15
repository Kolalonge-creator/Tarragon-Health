import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mentalHealthScreenSchema } from "@/lib/validation/mental-health-screen";
import { scorePhq9, scoreGad7, scoreAuditC, scoreEpds, EPDS_ITEM_COUNT } from "@/lib/rules/mental-health-screening";
import { flagHazardousAlcoholUse } from "@/lib/alcohol/escalate";
import type { Json, TablesInsert } from "@tarragon/shared";

/**
 * Mobile equivalent of apps/web/.../patient/mental-health-actions.ts's
 * submitMentalHealthScreen. Ported verbatim, not reimplemented — scoring
 * (PHQ-9/GAD-7/AUDIT-C/EPDS), the service-role insert (a client can never
 * post a spoofed total), the self-harm → emergency_events crisis pathway
 * (§18.2), and the hazardous-alcohol referral (§18.10) are exactly the same
 * logic as the web action, just reached over a bearer-authenticated route
 * instead of a cookie-authenticated server action. This is the one screen
 * on the whole platform where a missed crisis signal is the worst possible
 * outcome of a native/web drift, so nothing here is simplified.
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

  const parsed = mentalHealthScreenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please answer every question" },
      { status: 400 }
    );
  }
  const answers = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, sex")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const phq9Items = Array.from(
    { length: 9 },
    (_, i) => answers[`phq9_${i + 1}` as keyof typeof answers] as unknown as number
  );
  const gad7Items = Array.from(
    { length: 7 },
    (_, i) => answers[`gad7_${i + 1}` as keyof typeof answers] as unknown as number
  );
  const auditcItems = Array.from(
    { length: 3 },
    (_, i) => answers[`auditc_${i + 1}` as keyof typeof answers] as unknown as number
  );

  const phq9 = scorePhq9(phq9Items);
  const gad7 = scoreGad7(gad7Items);
  const auditc = scoreAuditC(auditcItems, profile.sex);

  const epdsItems = Array.from(
    { length: EPDS_ITEM_COUNT },
    (_, i) => answers[`epds_${i + 1}` as keyof typeof answers] as unknown as number | undefined
  );
  const epdsAnswered = answers.is_perinatal && epdsItems.every((v) => v !== undefined);
  const epds = epdsAnswered ? scoreEpds(epdsItems as number[]) : null;

  const service = createServiceRoleClient();
  const rows: TablesInsert<"mental_health_screens">[] = [
    {
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      instrument: "phq9",
      total_score: phq9.total,
      severity_band: phq9.band,
      crisis_flagged: phq9.crisis,
      item_responses: { items: phq9Items } as Json,
    },
    {
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      instrument: "gad7",
      total_score: gad7.total,
      severity_band: gad7.band,
      item_responses: { items: gad7Items } as Json,
    },
    {
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      instrument: "auditc",
      total_score: auditc.total,
      severity_band: auditc.band,
      hazardous: auditc.hazardous,
      item_responses: { items: auditcItems } as Json,
    },
  ];
  if (epds) {
    rows.push({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      instrument: "epds",
      total_score: epds.total,
      severity_band: epds.band,
      crisis_flagged: epds.crisis,
      item_responses: { items: epdsItems } as Json,
    });
  }
  const { error: insertError } = await service.from("mental_health_screens").insert(rows);
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const crisis = phq9.crisis || epds?.crisis === true;
  if (crisis) {
    const crisisSource = phq9.crisis ? "PHQ-9 item 9" : "EPDS item 10";
    await supabase.from("emergency_events").insert({
      patient_id: user.id,
      organisation_id: profile.organisation_id,
      source: "intake_screen",
      trigger_detail: `Wellbeing check-in: reported thoughts of self-harm (${crisisSource})`,
      status: "active",
    });
  }

  if (auditc.hazardous) {
    await flagHazardousAlcoholUse(user.id, profile.organisation_id, auditc.total).catch(() => undefined);
  }

  return NextResponse.json({ success: true, crisis });
}
