import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@tarragon/shared";
import type { Embedder } from "./embed-content";

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
 */
export async function findRelevantLifestyleContent(
  supabase: SupabaseClient<Database>,
  embedder: Embedder,
  queryText: string,
  opts: {
    matchCount?: number;
    conditionFilter?: Enums<"care_plan_condition"> | null;
    moduleFilter?: Enums<"lpe_module"> | null;
  } = {},
): Promise<RelevantContentBlock[]> {
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
