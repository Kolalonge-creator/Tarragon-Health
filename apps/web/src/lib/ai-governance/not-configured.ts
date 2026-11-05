import "server-only";
import { recordAiInteraction } from "./audit";
import type { AiGovernanceClient } from "./registry";

/**
 * Audit a governed AI call that could not run because the vendor credential is missing (ANTHROPIC_API_KEY unset or
 * removed). Call sites that check their own configuration before reaching the model used to return early here
 * without an audit row, so the `ai_call_failures` ops alert (which reads ai_interaction_log) could not see the very
 * outage it exists for: a revoked or missing key looks, from the outside, like "the draft did not appear".
 *
 * Recorded as a degraded fallback that carries an error_message: the shape the alert counts as a failure, and the
 * shape runGovernedAi already uses when a call site catches its own model failure. Never throws (recordAiInteraction
 * never throws).
 */
export async function recordAiCredentialMissing(
  supabase: AiGovernanceClient,
  params: {
    readonly systemCode: string;
    readonly inputCategory: string;
    readonly subjectProfileId?: string | null;
    readonly resultingEntityType?: string | null;
    readonly resultingEntityId?: string | null;
  }
): Promise<string | null> {
  const reason = "ANTHROPIC_API_KEY is not set";
  return recordAiInteraction(supabase, {
    systemCode: params.systemCode,
    modelIdentifier: "none:fallback",
    inputCategory: params.inputCategory,
    status: "fallback",
    subjectProfileId: params.subjectProfileId ?? null,
    fallbackReason: `the AI call failed: ${reason}`,
    errorMessage: reason,
    resultingAction: "manual_entry_required",
    resultingEntityType: params.resultingEntityType ?? null,
    resultingEntityId: params.resultingEntityId ?? null,
  });
}
