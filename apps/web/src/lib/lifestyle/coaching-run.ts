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
 *
 * `send_nudge`'s copy is personalised via createLifestyleCoachingProposer
 * (Claude, grounded in the patient's real programme/phase/goals) — but which
 * *action* to take is still decided deterministically (proposeNextAction),
 * and runCoachingLoop always routes the result through applyGuardrails, so
 * this is additive to the existing safety contract, not a change to it.
 */

import { runCoachingLoop, type ProgrammeSignals } from "@tarragon/lifestyle-engine";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createLifestyleMessagingGateway } from "./messaging-gateway";
import { createLifestyleCoachingProposer } from "./coaching-proposer";
import { CONDITION_LABEL, getLifestyleState } from "./service";
import { createVoyageEmbedderFromEnv } from "./voyage-embedder";
import { createGovernedMlClient } from "@/lib/ml/governed-ml-client";

export interface CoachingRunResult {
  processed: number;
  nudged: number;
  routedToDoctor: number;
}

const WINDOW_MS = 30 * 86_400_000;

export async function runLifestyleCoaching(): Promise<CoachingRunResult> {
  const svc = createServiceRoleClient();
  // Built once, reused for every patient this run — `null` when
  // VOYAGE_API_KEY is unset, so reference-material retrieval is skipped
  // gracefully for the whole run rather than per-patient.
  const embedder = createVoyageEmbedderFromEnv();

  const { data: enrollments } = await svc
    .from("lpe_enrollments")
    .select("id, patient_id, organisation_id, status, condition")
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

    // AI-010, per patient: the governed wrapper needs the subject to attribute
    // the audit row, so the client is built inside the loop rather than once
    // for the run. Governance itself is cached in-process, so this costs one
    // extra lookup per minute across the whole sweep, not one per patient.
    const ml = createGovernedMlClient(svc, {
      subjectProfileId: e.patient_id,
      inputCategory: "lifestyle_coaching_signals",
    });

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

    // Grounding for the proposer's copy, not for the (already-computed)
    // signals above — reuses the same getLifestyleState() the AI Coach's
    // context.ts and the patient-facing /patient/lifestyle page already
    // call, no parallel query path.
    const enrollmentViews = await getLifestyleState(svc, e.patient_id);
    const view = enrollmentViews.find((v) => v.id === e.id);
    const recentWeightKg = (meas ?? [])
      .filter((m) => m.type === "weight" && m.value_num !== null)
      .slice(0, 5)
      .map((m) => ({ value: m.value_num as number, takenAt: m.taken_at }));

    const proposer = createLifestyleCoachingProposer(
      {
        condition: e.condition,
        conditionLabel: CONDITION_LABEL[e.condition] ?? e.condition,
        programmeName: view?.programmeName ?? null,
        currentPhaseName: view?.currentPhaseName ?? null,
        goalTitles: view?.goals.map((g) => g.title) ?? [],
        recentWeightKg,
      },
      { supabase: svc, embedder, patientId: e.patient_id },
    );

    const { action } = await runCoachingLoop(signals, { proposer });

    if (action.kind === "send_nudge") {
      const gateway = createLifestyleMessagingGateway(e.organisation_id);
      const r = await gateway.send({
        patientId: e.patient_id,
        templateKey: "lifestyle_nudge",
        messageClass: "coaching_nudge",
        variables: action.message ? { message: action.message } : undefined,
      });
      if (r.ok) nudged++;
    } else if (action.kind === "request_doctor_review") {
      // Already surfaced on the worklist via the open red flag — count only.
      routedToDoctor++;
    }
  }

  return { processed: enrollments?.length ?? 0, nudged, routedToDoctor };
}
