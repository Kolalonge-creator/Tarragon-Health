/**
 * Coaching loop (spec §11) — the LangGraph-ready observe→propose→GUARDRAILS
 * cycle. An LLM proposer (LangGraph node calling Claude) is optional and
 * PLUGGABLE; whether the proposal comes from the LLM or the rule-based core, it
 * is ALWAYS routed through `applyGuardrails` before it can act. With no proposer
 * configured the loop degrades to the deterministic rule-based decision, so the
 * platform never depends on an LLM being reachable.
 *
 * The safety contract lives in `applyGuardrails` (agent/index.ts): the LLM can
 * never emit a clinical action, nudge a paused programme, or override a pause —
 * a rogue proposal is structurally overridden here, proven by test.
 */
import {
  applyGuardrails,
  proposeNextAction,
  type CoachingAction,
  type ProgrammeSignals,
} from "./index";

/** A pluggable proposal source — implemented in apps/web by a LangGraph node
 *  that calls Claude, or left undefined to use the rule-based core. */
export interface CoachingProposer {
  propose(signals: ProgrammeSignals): Promise<CoachingAction>;
}

export interface CoachingLoopResult {
  action: CoachingAction;
  /** Where the pre-guardrail proposal came from. */
  proposedBy: "llm" | "rules";
  /** True if a guardrail overrode the proposal (always safe-side). */
  guardrailOverrode: boolean;
}

export async function runCoachingLoop(
  signals: ProgrammeSignals,
  opts: { proposer?: CoachingProposer } = {},
): Promise<CoachingLoopResult> {
  let proposal: CoachingAction;
  let proposedBy: "llm" | "rules";

  if (opts.proposer) {
    try {
      proposal = await opts.proposer.propose(signals);
      proposedBy = "llm";
    } catch {
      // A failing LLM proposer must never break coaching — fall back to rules.
      proposal = proposeNextAction(signals);
      proposedBy = "rules";
    }
  } else {
    proposal = proposeNextAction(signals);
    proposedBy = "rules";
  }

  const guarded = applyGuardrails(proposal, signals);
  return {
    action: guarded.action,
    proposedBy,
    guardrailOverrode: guarded.overridden,
  };
}
