import "server-only";
/**
 * Coaching run (spec §11, §13) — computes per-programme signals and decides the
 * next supportive action for each live enrollment, enqueuing nudges through the
 * MessagingGateway. Ties the ML signals + the guarded agent core to live data.
 *
 * Degrades gracefully: if the ML service is unreachable (no env / down / slow),
 * it falls back to a local recency heuristic — the platform keeps working
 * without ML, per the never-throw ml-client contract. Paused programmes are
 * excluded (they are a doctor's, not the coach's), so a nudge can never be sent
 * to a paused patient even before the agent's guardrail runs.
 */
import { createMlClientFromEnv } from "@tarragon/shared";
import {
  decideCoachingAction,
  type ProgrammeSignals,
} from "@tarragon/lifestyle-engine";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createLifestyleMessagingGateway } from "./messaging-gateway";

export interface CoachingRunResult {
  processed: number;
  nudged: number;
  routedToDoctor: number;
}

const WINDOW_MS = 30 * 86_400_000;

export async function runLifestyleCoaching(): Promise<CoachingRunResult> {
  const svc = createServiceRoleClient();
  const ml = createMlClientFromEnv();

  const { data: enrollments } = await svc
    .from("lpe_enrollments")
    .select("id, patient_id, organisation_id, status")
    .in("status", ["active", "maintenance"]);

  let nudged = 0;
  let routedToDoctor = 0;

  for (const e of enrollments ?? []) {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data: meas } = await svc
      .from("lpe_measurements")
      .select("type, value_num, taken_at")
      .eq("patient_id", e.patient_id)
      .gte("taken_at", since)
      .order("taken_at", { ascending: false });

    const logs = (meas ?? []).map((m) => m.taken_at);
    const asOf = new Date().toISOString();

    let disengagementRisk = 0;
    let daysSinceLastLog: number | null = null;
    let plateauDetected = false;

    const engagement = ml
      ? await ml.lifestyleEngagement({ log_timestamps: logs, as_of: asOf })
      : null;
    if (engagement) {
      disengagementRisk = engagement.disengagement_risk;
      daysSinceLastLog = engagement.days_since_last_log;
    } else {
      // Local fallback when ML is unavailable.
      if (logs[0]) {
        daysSinceLastLog = Math.max(
          0,
          Math.floor((Date.now() - new Date(logs[0]).getTime()) / 86_400_000),
        );
        disengagementRisk = Math.min(1, daysSinceLastLog / 10);
      } else {
        disengagementRisk = 1;
      }
    }

    if (ml) {
      const weights = (meas ?? [])
        .filter((m) => m.type === "weight" && m.value_num !== null)
        .map((m) => ({ taken_at: m.taken_at, value: m.value_num as number }));
      if (weights.length >= 2) {
        const trend = await ml.lifestyleTrends({ points: weights });
        if (trend) plateauDetected = trend.plateau_detected;
      }
    }

    const { count } = await svc
      .from("lpe_red_flag_events")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", e.patient_id)
      .eq("status", "open");

    const signals: ProgrammeSignals = {
      isPaused: e.status === "paused", // always false here — paused is excluded
      hasOpenRedFlag: (count ?? 0) > 0,
      disengagementRisk,
      daysSinceLastLog,
      plateauDetected,
    };

    const action = decideCoachingAction(signals);

    if (action.kind === "send_nudge") {
      const gateway = createLifestyleMessagingGateway(e.organisation_id);
      const r = await gateway.send({
        patientId: e.patient_id,
        templateKey: "lifestyle_nudge",
        messageClass: "coaching_nudge",
      });
      if (r.ok) nudged++;
    } else if (action.kind === "request_doctor_review") {
      // Already surfaced on the worklist via the open red flag — count only.
      routedToDoctor++;
    }
  }

  return { processed: enrollments?.length ?? 0, nudged, routedToDoctor };
}
