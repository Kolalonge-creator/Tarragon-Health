import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * A minimized, structured picture of why a video visit was booked -- never
 * the patient's full chart. Same "one narrow snapshot, never the whole
 * record" discipline as patient-explainer/case-briefs.
 */
export interface AppointmentPrepSnapshot {
  context: string;
  scheduledAt: string | null;
  /** Humanized condition names from the patient's active care plans. */
  conditions: string[];
  /** The reason an escalation-triggered visit was raised, when this
   * consultation was linked to one -- never fabricated if absent. */
  escalationReason: string | null;
}

/**
 * Best-effort -- never throws. Returns null when the consultation doesn't
 * belong to this patient or doesn't exist, same "degrade to no snapshot"
 * shape as case-briefs/patient-explainer.
 */
export async function buildAppointmentPrepSnapshot(
  supabase: SupabaseClient<Database>,
  patientId: string,
  consultationId: string
): Promise<AppointmentPrepSnapshot | null> {
  const { data: consult } = await supabase
    .from("video_consultations")
    .select("context, scheduled_at, escalation_id")
    .eq("id", consultationId)
    .eq("patient_id", patientId)
    .maybeSingle();
  if (!consult) return null;

  const { data: plans } = await supabase
    .from("care_plans")
    .select("condition")
    .eq("patient_id", patientId)
    .eq("status", "active");

  let escalationReason: string | null = null;
  if (consult.escalation_id) {
    const { data: escalation } = await supabase
      .from("escalations")
      .select("reason")
      .eq("id", consult.escalation_id)
      .maybeSingle();
    escalationReason = escalation?.reason ?? null;
  }

  return {
    context: consult.context,
    scheduledAt: consult.scheduled_at,
    conditions: (plans ?? []).map((p) => humanizeCondition(p.condition)),
    escalationReason,
  };
}

function humanizeCondition(condition: string): string {
  return condition
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const CONTEXT_LABEL: Record<string, string> = {
  pre_referral_triage: "a pre-referral triage visit",
  specialist_consult: "a specialist consult",
  general_checkin: "a general check-in",
};

/**
 * Renders a snapshot into the plain-text block the model sees. Pure and
 * deterministic, unit-testable without a live Supabase client or a Claude
 * call -- same discipline as formatResultSnapshotForPrompt/
 * formatSnapshotForPrompt.
 */
export function formatAppointmentPrepSnapshotForPrompt(snapshot: AppointmentPrepSnapshot): string {
  const lines: string[] = [
    `Visit type: ${CONTEXT_LABEL[snapshot.context] ?? snapshot.context}`,
  ];
  lines.push(
    snapshot.conditions.length > 0
      ? `Known conditions on this patient's care plan: ${snapshot.conditions.join(", ")}.`
      : "No active care-plan conditions on file."
  );
  lines.push(
    snapshot.escalationReason
      ? `This visit was booked following a flagged concern: "${snapshot.escalationReason}"`
      : "No specific flagged concern on file for why this visit was booked."
  );
  return lines.join("\n");
}
