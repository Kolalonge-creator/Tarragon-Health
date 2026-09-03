import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@tarragon/shared";
import type { Embedder } from "./embed-content";
import { AI_SYSTEMS, decideAiGovernance, recordAiInteraction } from "@/lib/ai-governance";

export interface RelevantContentBlock {
  id: string;
  key: string;
  title: string;
  bodyMd: string;
  condition: Enums<"care_plan_condition"> | null;
  module: Enums<"lpe_module"> | null;
  similarity: number;
}

/**
 * Semantic retrieval over lpe_content_blocks via the match_lpe_content_blocks
 * RPC (20260810034407_match_lpe_content_blocks_rpc.sql). Best-effort: never
 * throws, returns `[]` on any failure (embedding the query text, the RPC
 * call itself) so a caller can treat "no relevant content" and "retrieval
 * broke" identically — this is a personalisation nicety, not a safety path,
 * so it should never be the reason a coaching turn or nudge fails.
 *
 * RLS on lpe_content_blocks already restricts a non-admin session to
 * clinician_reviewed rows (20260810034122_gate_lpe_content_blocks_read_on_
 * review_status.sql), and the RPC itself re-applies that filter explicitly —
 * this function doesn't need its own review-status check on top.
 *
 * Called from ai-coach/graph.ts's llmTurn (chat) and lifestyle/coaching-
 * proposer.ts's propose() (the daily nudge) — both pass their own embedder
 * (Voyage, or `null`/undefined to skip) and treat an empty result the same
 * as "retrieval unavailable": personalisation degrades, nothing breaks.
 *
 * GOVERNANCE (AI-009). The embedding provider is a registered AI system, so
 * the kill switch is honoured here: switched off, this returns `[]` and the
 * caller degrades exactly as it already does when VOYAGE_API_KEY is unset.
 * Only a switched-off or unregistered outcome is written to
 * ai_interaction_log, and only when a subject is known — AI-009 is not
 * clinically meaningful (it retrieves clinician-approved educational text and
 * reaches no patient directly), so 40.11's per-interaction audit requirement
 * does not apply to its successful reads, and logging one row per retrieval
 * would bury the interactions that do matter.
 */
export async function findRelevantLifestyleContent(
  supabase: SupabaseClient<Database>,
  embedder: Embedder,
  queryText: string,
  opts: {
    matchCount?: number;
    conditionFilter?: Enums<"care_plan_condition"> | null;
    moduleFilter?: Enums<"lpe_module"> | null;
    /** The patient the retrieval is for, where the caller knows it. Used only
     * to attribute a switched-off outcome; omitting it skips that audit row
     * rather than blocking retrieval. */
    subjectProfileId?: string | null;
  } = {},
): Promise<RelevantContentBlock[]> {
  const governance = await decideAiGovernance(supabase, AI_SYSTEMS.lifestyleEmbeddings.code);
  if (!governance.allow) {
    if (opts.subjectProfileId) {
      await recordAiInteraction(supabase, {
        systemCode: AI_SYSTEMS.lifestyleEmbeddings.code,
        modelIdentifier: "none:fallback",
        inputCategory: "lifestyle_content_retrieval",
        status: "fallback",
        subjectProfileId: opts.subjectProfileId,
        fallbackReason: governance.message,
        resultingAction: "no_reference_material_retrieved",
      });
    }
    return [];
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedder.embed(queryText);
  } catch {
    return [];
  }

  const { data, error } = await supabase.rpc("match_lpe_content_blocks", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: opts.matchCount ?? 3,
    filter_condition: opts.conditionFilter ?? undefined,
    filter_module: opts.moduleFilter ?? undefined,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    key: row.key,
    title: row.title,
    bodyMd: row.body_md,
    condition: row.condition,
    module: row.module,
    similarity: row.similarity,
  }));
}
