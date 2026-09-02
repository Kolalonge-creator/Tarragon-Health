import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@tarragon/shared";
import type { Embedder } from "@/lib/lifestyle/embed-content";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * §36.15/§36.16 — retrieval over health_education_content, the second
 * approved-content source the AI Coach draws on (the first is
 * lpe_content_blocks, via lib/lifestyle/find-relevant-content.ts, which
 * stays lifestyle-programme-scoped by design). Unlike the lifestyle path,
 * this one is NOT gated to an active programme enrolment — any patient can
 * ask a general health-education question, so this is what closes that gap
 * (docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §4's "one library out of
 * three, and currently inert" finding for the second library).
 *
 * Same pluggable-embedder, graceful-no-op shape as
 * lib/lifestyle/embed-content.ts's populateContentEmbeddings — this is a
 * deliberate mirror, not a coincidence, so both content libraries behave
 * identically to whoever operates them.
 */

export interface EmbedRunResult {
  embedded: number;
  skipped: number;
  reason?: string;
}

export async function populateHealthEducationEmbeddings(embedder?: Embedder): Promise<EmbedRunResult> {
  if (!embedder) {
    return { embedded: 0, skipped: 0, reason: "no_embedder_configured" };
  }

  const svc = createServiceRoleClient();
  const { data: rows } = await svc
    .from("health_education_content")
    .select("id, title, summary, body")
    .eq("clinician_reviewed", true)
    .is("embedding", null);

  if (!rows?.length) return { embedded: 0, skipped: 0, reason: "nothing_to_embed" };

  let embedded = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const text = [row.title, row.summary, row.body].filter(Boolean).join("\n\n");
      const vector = await embedder.embed(text);
      const { error } = await svc
        .from("health_education_content")
        .update({ embedding: JSON.stringify(vector) })
        .eq("id", row.id);
      if (error) skipped++;
      else embedded++;
    } catch {
      skipped++;
    }
  }
  return { embedded, skipped };
}

export interface RelevantHealthEducationContent {
  id: string;
  code: string;
  title: string;
  /** Prefers summary; falls back to a truncated body — mirrors how
   * find-relevant-content.ts hands back the full bodyMd for lpe blocks, but
   * health_education_content's body can run much longer (full articles), so
   * this trims it for prompt-context use. */
  excerpt: string;
  condition: Enums<"care_plan_condition"> | null;
  similarity: number;
}

const EXCERPT_MAX_CHARS = 600;

/**
 * Best-effort: never throws, returns `[]` on any failure — same contract as
 * find-relevant-content.ts's findRelevantLifestyleContent, which this
 * mirrors. RLS on health_education_content already lets any authenticated
 * user read `is_active` rows (20260717150000_health_education.sql); the RPC
 * additionally requires `clinician_reviewed = true`, which RLS alone does
 * not — see match_health_education_content's own migration comment.
 */
export async function findRelevantHealthEducationContent(
  supabase: SupabaseClient<Database>,
  embedder: Embedder,
  queryText: string,
  opts: { matchCount?: number; conditionFilter?: Enums<"care_plan_condition"> | null } = {}
): Promise<RelevantHealthEducationContent[]> {
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedder.embed(queryText);
  } catch {
    return [];
  }

  const { data, error } = await supabase.rpc("match_health_education_content", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: opts.matchCount ?? 3,
    filter_condition: opts.conditionFilter ?? undefined,
  });

  if (error || !data) return [];

  return data.map((row) => {
    const body = row.body ?? "";
    const excerptSource = row.summary && row.summary.trim().length > 0 ? row.summary : body;
    const excerpt =
      excerptSource.length > EXCERPT_MAX_CHARS ? `${excerptSource.slice(0, EXCERPT_MAX_CHARS)}…` : excerptSource;
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      excerpt,
      condition: row.condition,
      similarity: row.similarity,
    };
  });
}
