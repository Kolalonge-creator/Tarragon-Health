import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachSource, Database } from "@tarragon/shared";

/**
 * S51 (spec 7.2, D1 mapping): every row the assistant may answer from carries an owner clinician, a version and a review date, read
 * through `assistant_knowledge_sources`. A row with no owner, no review date or a review date in the past is NOT retrievable. Fails
 * closed: a failed lookup returns an empty map, so nothing is treated as reviewed.
 */
export interface KnowledgeSource {
  id: string;
  sourceTable: "health_education_content" | "lpe_content_blocks";
  title: string;
  owner: string | null;
  version: number;
  reviewDueAt: string | null;
  retrievable: boolean;
}

interface Row {
  id?: unknown;
  source_table?: unknown;
  title?: unknown;
  owner?: unknown;
  version?: unknown;
  review_due_at?: unknown;
  retrievable?: unknown;
}

export async function loadKnowledgeSources(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<Map<string, KnowledgeSource>> {
  const out = new Map<string, KnowledgeSource>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("assistant_knowledge_sources", { p_ids: ids });
    if (error || !Array.isArray(data)) return out;
    for (const raw of data as Row[]) {
      if (typeof raw.id !== "string") continue;
      out.set(raw.id, {
        id: raw.id,
        sourceTable: raw.source_table === "lpe_content_blocks" ? "lpe_content_blocks" : "health_education_content",
        title: typeof raw.title === "string" ? raw.title : "",
        owner: typeof raw.owner === "string" ? raw.owner : null,
        version: typeof raw.version === "number" ? raw.version : 1,
        reviewDueAt: typeof raw.review_due_at === "string" ? raw.review_due_at : null,
        retrievable: raw.retrievable === true,
      });
    }
  } catch {
    return new Map();
  }
  return out;
}

/** The patient-facing form of a retrievable row. Never includes a link or id supplied by a model. */
export function toCoachSource(k: KnowledgeSource): CoachSource {
  return {
    kind: "reviewed_content",
    title: k.title,
    ...(k.owner ? { owner: k.owner } : {}),
    version: k.version,
    ...(k.reviewDueAt ? { reviewDue: k.reviewDueAt.slice(0, 10) } : {}),
  };
}
