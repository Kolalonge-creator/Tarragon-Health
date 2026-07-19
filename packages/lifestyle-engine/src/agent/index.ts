/**
 * Coaching-agent core (spec §11) — the guarded "next best supportive action"
 * decision. This is the pure, testable heart a LangGraph loop wraps: observe →
 * propose → GUARDRAILS. It is deliberately NOT an LLM call — the safety-critical
 * logic lives here so it can be unit-tested to 100%, and any LLM layer added
 * later must route its proposal through `applyGuardrails` before acting.
 *
 * HARD GUARDRAILS (spec §11, §18.7):
 *  - The agent can NEVER emit a clinical action (prescribe/diagnose/titrate) —
 *    those are not in the action set at all.
 *  - It can NEVER push weight-loss at a paused programme, or override a pause.
 *  - An open red flag or a paused programme routes to a doctor, never a nudge.
 */

export type CoachingActionKind =
  | "send_nudge"
  | "surface_content"
  | "adjust_task_difficulty"
  | "request_doctor_review"
  | "none";

export interface ProgrammeSignals {
  isPaused: boolean;
  hasOpenRedFlag: boolean;
  disengagementRisk: number; // 0..1
  daysSinceLastLog: number | null;
  plateauDetected: boolean;
}

export interface CoachingAction {
  kind: CoachingActionKind;
  /** Machine reason for the choice (telemetry + auditability). */
  reason: string;
}

/**
 * Propose the next supportive action from programme signals. Pure and
 * deterministic. Safety always wins: a paused programme or an open flag routes
 * to a doctor and never nudges.
 */
export function proposeNextAction(signals: ProgrammeSignals): CoachingAction {
  if (signals.hasOpenRedFlag) {
    return { kind: "request_doctor_review", reason: "open_red_flag" };
  }
  if (signals.isPaused) {
    // Never coach a paused programme toward its goals — a doctor owns the resume.
    return { kind: "request_doctor_review", reason: "programme_paused" };
  }
  if (signals.disengagementRisk >= 0.6 || (signals.daysSinceLastLog ?? 0) >= 7) {
    return { kind: "send_nudge", reason: "disengagement" };
  }
  if (signals.plateauDetected) {
    return { kind: "adjust_task_difficulty", reason: "plateau" };
  }
  return { kind: "surface_content", reason: "steady_progress" };
}

export interface GuardrailResult {
  action: CoachingAction;
  /** True if the proposal was overridden by a guardrail. */
  overridden: boolean;
}

/**
 * The single choke point every agent proposal (rule-based OR future LLM) must
 * pass through before acting. Enforces the hard guardrails structurally.
 */
export function applyGuardrails(
  proposed: CoachingAction,
  signals: ProgrammeSignals,
): GuardrailResult {
  // A paused programme or an open flag can only ever route to a doctor.
  if (signals.isPaused || signals.hasOpenRedFlag) {
    if (proposed.kind !== "request_doctor_review") {
      return {
        action: {
          kind: "request_doctor_review",
          reason: signals.isPaused ? "guardrail_paused" : "guardrail_open_flag",
        },
        overridden: true,
      };
    }
  }
  return { action: proposed, overridden: false };
}

/** Convenience: propose + guardrail in one call (what a caller should use). */
export function decideCoachingAction(signals: ProgrammeSignals): CoachingAction {
  return applyGuardrails(proposeNextAction(signals), signals).action;
}

export * from "./loop";
