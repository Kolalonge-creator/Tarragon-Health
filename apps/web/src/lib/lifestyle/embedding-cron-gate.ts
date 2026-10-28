import "server-only";
import { AI_SYSTEMS, decideAiGovernance, type AiGovernanceClient } from "@/lib/ai-governance";

/**
 * The kill switch for the two daily content-embedding crons (audit G-08). Embedding is AI-009: switching it off in the registry used to
 * stop the query-time search but not these two index-time crons, which kept calling the embedding provider. Both crons ask here first.
 *
 * Returns null when the run may go ahead, or a skip result to return as the response body. The content being embedded is
 * clinician-reviewed library text with no patient data, and AI-009 is low risk, so an unreachable registry does not stop the run
 * (the registry mirror in system-codes.ts sets failClosedIfGovernanceUnavailable to false for it); only an explicit "off" or an
 * unregistered system does.
 */
export async function embeddingCronSkip(supabase: AiGovernanceClient): Promise<{ skipped: true; reason: string } | null> {
  const decision = await decideAiGovernance(supabase, AI_SYSTEMS.lifestyleEmbeddings.code);
  if (decision.allow) return null;
  return { skipped: true, reason: decision.reason };
}
