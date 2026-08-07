import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Don't re-nudge the same patient about the same signal more than once a month. */
const ATTENTION_NUDGE_COOLDOWN_DAYS = 30;

/**
 * Best-effort: queues a `risk_signal_attention` notification (see
 * supabase/functions/send-pending-notifications) the first time — or first
 * time in ATTENTION_NUDGE_COOLDOWN_DAYS — a given risk signal turns
 * high/very_high (or otherwise newly worsens) for this patient. Dedupes
 * against the notifications table itself rather than a new column, the same
 * idea as assessHeartRateBestEffort's "skip if an open alert already exists"
 * check (apps/web/src/lib/vitals/assess-heart-rate.ts).
 *
 * Shared by every risk-signal trigger (BP-control, CV-risk lipid trend, ...)
 * so voice and dedupe behaviour stay identical regardless of which signal
 * fired — never throws, matching every other best-effort function in this
 * codebase.
 */
export async function queueRiskSignalAttentionBestEffort(
  patientId: string,
  organisationId: string,
  scoreType: string,
  signalLabel: string,
  reason: string
): Promise<void> {
  try {
    const serviceRoleClient = createServiceRoleClient();
    const since = new Date(
      Date.now() - ATTENTION_NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: recent } = await serviceRoleClient
      .from("notifications")
      .select("id")
      .eq("recipient_id", patientId)
      .eq("template", "risk_signal_attention")
      .contains("payload", { score_type: scoreType })
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) return;

    await serviceRoleClient.from("notifications").insert({
      organisation_id: organisationId,
      recipient_id: patientId,
      channel: "whatsapp",
      status: "pending",
      template: "risk_signal_attention",
      payload: { score_type: scoreType, signal_label: signalLabel, reason },
    });
  } catch {
    // Best-effort — a nudge failing to queue must never block the caller's
    // own primary write (a vitals log, a lipid result recording, ...).
  }
}
