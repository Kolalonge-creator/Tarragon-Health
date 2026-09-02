import "server-only";
import { recordAiInteraction } from "./audit";
import { decideAiGovernance, type AiGovernanceClient } from "./registry";
import type {
  AiOutputFlag,
  AiRuntimeConfig,
  AiSafetyClassification,
  AiBlockReason,
} from "./types";

/**
 * The one wrapper every AI call site goes through. It is the place where
 * Module 40's three runtime obligations meet:
 *
 *   40.17  the kill switch is checked before the model is reached;
 *   40.18  a system that is off, or unreachable, runs its non-AI fallback
 *          instead of failing — care continues;
 *   40.11  every outcome, including a fallback or a failure, lands in the
 *          audit trail with the model, prompt version, safety
 *          classification and resulting action.
 *
 * The shape is deliberately "give me the AI path and the fallback path, and
 * I will pick one". A call site that could only express the AI path would
 * have nowhere to go when the switch is off, and the pressure would be to
 * skip the check.
 */

export interface GovernedRunContext {
  /**
   * The governed record, or null when nothing has been activated for this
   * system yet. Null means "use your in-repo constants" — never "run with no
   * prompt".
   */
  readonly config: AiRuntimeConfig | null;
}

export interface GovernedRunOutcome<T> {
  readonly value: T;
  /** The model that actually answered. Checked against the approved version. */
  readonly modelIdentifier: string;
  readonly outputSummary?: string | null;
  readonly safetyClassification?: AiSafetyClassification | null;
  readonly guardrailsTriggered?: readonly string[];
  readonly outputFlags?: readonly AiOutputFlag[];
  readonly knowledgeSourceIds?: readonly string[];
  readonly resultingAction?: string | null;
  readonly resultingEntityType?: string | null;
  readonly resultingEntityId?: string | null;
  readonly inputTokenCount?: number | null;
  readonly outputTokenCount?: number | null;
  /**
   * Set when the AI path itself decided to suppress its output — a guardrail
   * match rather than an error. Logged as `blocked`, not `completed`.
   */
  readonly blockedByGuardrail?: boolean;
}

export interface RunGovernedAiParams<T> {
  readonly supabase: AiGovernanceClient;
  readonly systemCode: string;
  /** A category, never the patient's words. See recordAiInteraction. */
  readonly inputCategory: string;
  readonly subjectProfileId?: string | null;
  /** The AI path. Only called when governance allows it. */
  readonly run: (ctx: GovernedRunContext) => Promise<GovernedRunOutcome<T>>;
  /**
   * The non-AI path (40.18). Called when the system is switched off,
   * unregistered, governance is unreachable and this system fails closed, or
   * the AI path threw. Must not itself depend on the model.
   *
   * `error` is set only for the "ai_error" reason, so a call site that
   * persists a failure record can write the real cause rather than a generic
   * one — losing the reason is what makes these failures undebuggable.
   */
  readonly fallback: (reason: AiFallbackReason, error?: unknown) => Promise<T> | T;
}

export type AiFallbackReason = AiBlockReason | "ai_error";

export interface RunGovernedAiResult<T> {
  readonly value: T;
  /** What actually happened, matching what was written to the audit trail. */
  readonly status: "completed" | "blocked" | "fallback" | "failed";
  /** Null when the audit write itself failed — never a reason to fail the call. */
  readonly interactionId: string | null;
  readonly config: AiRuntimeConfig | null;
  /** Set when the fallback ran, so the caller can explain itself to a user. */
  readonly fallbackReason: AiFallbackReason | null;
}

const FALLBACK_EXPLANATION: Record<AiFallbackReason, string> = {
  kill_switch: "switched off by clinical governance",
  unregistered: "not registered in the AI registry",
  governance_unavailable: "AI governance unreadable and this system fails closed",
  ai_error: "the AI call failed",
};

export async function runGovernedAi<T>(
  params: RunGovernedAiParams<T>
): Promise<RunGovernedAiResult<T>> {
  const { supabase, systemCode, inputCategory, subjectProfileId } = params;
  const decision = await decideAiGovernance(supabase, systemCode);

  if (!decision.allow) {
    const value = await params.fallback(decision.reason);
    const interactionId = await recordAiInteraction(supabase, {
      systemCode,
      // There was no model. Recording the system's own code rather than a
      // fake model name keeps ai_vendor_model_observations honest -- the
      // fallback path deliberately skips the model-drift check.
      modelIdentifier: "none:fallback",
      inputCategory,
      status: "fallback",
      subjectProfileId,
      fallbackReason: `${FALLBACK_EXPLANATION[decision.reason]} — ${decision.message}`,
      resultingAction: "fallback_path_used",
    });

    return {
      value,
      status: "fallback",
      interactionId,
      config: decision.config,
      fallbackReason: decision.reason,
    };
  }

  const startedAt = Date.now();

  try {
    const outcome = await params.run({ config: decision.config });
    const status = outcome.blockedByGuardrail ? "blocked" : "completed";

    const interactionId = await recordAiInteraction(supabase, {
      systemCode,
      modelIdentifier: outcome.modelIdentifier,
      inputCategory,
      status,
      subjectProfileId,
      outputSummary: outcome.outputSummary,
      safetyClassification: outcome.safetyClassification,
      guardrailsTriggered: outcome.guardrailsTriggered,
      outputFlags: outcome.outputFlags,
      promptVersionId: decision.config?.prompt?.prompt_version_id ?? null,
      knowledgeSourceIds: outcome.knowledgeSourceIds,
      resultingAction: outcome.resultingAction,
      resultingEntityType: outcome.resultingEntityType,
      resultingEntityId: outcome.resultingEntityId,
      latencyMs: Date.now() - startedAt,
      inputTokenCount: outcome.inputTokenCount,
      outputTokenCount: outcome.outputTokenCount,
    });

    return {
      value: outcome.value,
      status,
      interactionId,
      config: decision.config,
      fallbackReason: null,
    };
  } catch (error) {
    // 40.18: the AI failing is not the workflow failing. Run the fallback
    // and record the failure, rather than letting the error reach the user.
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("ai-governance: AI path failed, running fallback", { systemCode, error });

    const value = await params.fallback("ai_error", error);
    const interactionId = await recordAiInteraction(supabase, {
      systemCode,
      modelIdentifier: "none:fallback",
      inputCategory,
      status: "fallback",
      subjectProfileId,
      fallbackReason: `${FALLBACK_EXPLANATION.ai_error}: ${message}`,
      resultingAction: "fallback_path_used",
      latencyMs: Date.now() - startedAt,
      errorMessage: message,
    });

    return {
      value,
      status: "fallback",
      interactionId,
      config: decision.config,
      fallbackReason: "ai_error",
    };
  }
}
