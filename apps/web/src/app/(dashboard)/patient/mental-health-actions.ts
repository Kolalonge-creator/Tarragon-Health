"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mentalHealthScreenSchema } from "@/lib/validation/mental-health-screen";
import {
  scorePhq9,
  scoreGad7,
  scoreAuditC,
  scoreEpds,
  EPDS_ITEM_COUNT,
} from "@/lib/rules/mental-health-screening";
import { flagHazardousAlcoholUse } from "@/lib/alcohol/escalate";
import type { Json, TablesInsert } from "@tarragon/shared";

export type SubmitMentalHealthState =
  | { error?: string; success?: boolean; crisis?: boolean }
  | undefined;

/**
 * Records a mental-health screen (AHC pathway §11; Module 46 §46.3): PHQ-9,
 * GAD-7, AUDIT-C, and — only when the patient opted in as pregnant/postpartum
 * — EPDS. Scores are computed here (never trusting the client) and written to
 * mental_health_screens via the service role — a client can't post a spoofed
 * total. A PHQ-9 item-9 or EPDS item-10 (self-harm) positive raises an
 * emergency_events row (source 'intake_screen'), which the existing
 * handle_emergency_event trigger escalates immediately (§18.2). A moderate/
 * high-concern (non-crisis) band is separately escalated to a clinician by
 * private.classify_mental_health_screen_concern's AFTER INSERT trigger on
 * mental_health_screens (§46.5) — this action never raises a clinician_alerts
 * row itself. The screen is never "actioned by software alone" either way, a
 * doctor reviews and reaches out.
 */
export async function submitMentalHealthScreen(
  _prevState: SubmitMentalHealthState,
  formData: FormData
): Promise<SubmitMentalHealthState> {
  const parsed = mentalHealthScreenSchema.safeParse(Object.fromEntries(formData.entries()));
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
    .select("organisation_id, sex")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

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

  // EPDS is opt-in (perinatal self-identification) — only score/insert it
  // when the patient answered the full set, never a partial/spoofed subset.
  const epdsItems = Array.from(
    { length: EPDS_ITEM_COUNT },
    (_, i) => answers[`epds_${i + 1}` as keyof typeof answers] as unknown as number | undefined
  );
  const epdsAnswered = answers.is_perinatal && epdsItems.every((v) => v !== undefined);
  const epds = epdsAnswered ? scoreEpds(epdsItems as number[]) : null;

  // System-computed rows — service role, same reasoning as prevention_risk_scores.
  //
  // Accepted tension with the service-role helper's "never for a patient's own
  // raw input" contract: item_responses IS the patient's raw input, but it
  // rides in the same row as the server-computed score, and the table
  // deliberately has no patient INSERT policy (20260719144000) precisely so a
  // client can never post a spoofed total. Identity is still the
  // authenticated session's user.id, never anything client-supplied, and
  // splitting the raw answers into a second RLS-scoped insert would break the
  // row's atomicity (a score row with no answers, or answers with no score).
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
  if (insertError) return { error: insertError.message };

  // Self-harm → emergency pathway (§18.2). Inserted under the patient's own
  // session (their emergency_events_insert RLS allows it), mirroring
  // reportDangerSymptoms — the trigger raises the Priority-1 alert.
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

  // Alcohol referral pathway (spec §18.10) — best-effort, never blocks the
  // screen itself from saving.
  if (auditc.hazardous) {
    await flagHazardousAlcoholUse(user.id, profile.organisation_id, auditc.total).catch(() => undefined);
  }

  return { success: true, crisis };
}
