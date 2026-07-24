"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mentalHealthScreenSchema } from "@/lib/validation/mental-health-screen";
import {
  scorePhq9,
  scoreGad7,
  scoreAuditC,
} from "@/lib/rules/mental-health-screening";
import type { Json } from "@tarragon/shared";

export type SubmitMentalHealthState =
  | { error?: string; success?: boolean; crisis?: boolean }
  | undefined;

/**
 * Records a mental-health screen (AHC pathway §11): PHQ-9, GAD-7, AUDIT-C.
 * Scores are computed here (never trusting the client) and written to
 * mental_health_screens via the service role — a client can't post a spoofed
 * total. A PHQ-9 item-9 (self-harm) positive raises an emergency_events row
 * (source 'intake_screen'), which the existing handle_emergency_event trigger
 * escalates immediately (§18.2) — the screen is never "actioned by software
 * alone", a doctor reviews and reaches out.
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

  const phq9Items = Array.from({ length: 9 }, (_, i) => answers[`phq9_${i + 1}` as keyof typeof answers]);
  const gad7Items = Array.from({ length: 7 }, (_, i) => answers[`gad7_${i + 1}` as keyof typeof answers]);
  const auditcItems = Array.from({ length: 3 }, (_, i) => answers[`auditc_${i + 1}` as keyof typeof answers]);

  const phq9 = scorePhq9(phq9Items);
  const gad7 = scoreGad7(gad7Items);
  const auditc = scoreAuditC(auditcItems, profile.sex);

  // System-computed rows — service role, same reasoning as prevention_risk_scores.
  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("mental_health_screens").insert([
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
  ]);
  if (insertError) return { error: insertError.message };

  // Self-harm → emergency pathway (§18.2). Inserted under the patient's own
  // session (their emergency_events_insert RLS allows it), mirroring
  // reportDangerSymptoms — the trigger raises the Priority-1 alert.
  if (phq9.crisis) {
    await supabase.from("emergency_events").insert({
      patient_id: user.id,
      organisation_id: profile.organisation_id,
      source: "intake_screen",
      trigger_detail: "Wellbeing check-in: reported thoughts of self-harm (PHQ-9 item 9)",
      status: "active",
    });
  }

  return { success: true, crisis: phq9.crisis };
}
