import "server-only";
/**
 * Content-embedding population for pgvector personalisation (spec §11).
 *
 * Pluggable embedder. With no provider configured (no `embedder` argument
 * passed) this is a graceful no-op that reports why. A real Voyage AI
 * provider now exists (voyage-embedder.ts, `createVoyageEmbedderFromEnv`) —
 * this stays a no-op only until `VOYAGE_API_KEY` is actually set in the
 * environment, at which point the cron route that calls this
 * (`/api/cron/lpe-embed-content`) starts populating embeddings for every
 * content block with `embedding is null` on its next run, no further code
 * changes needed. A 58-block draft content library exists
 * (20260810032440_lpe_content_library_starter.sql +
 * 20260810034049_lpe_content_library_expansion.sql), so there's real content
 * ready to embed; it's still all `clinician_reviewed = false`, and RLS
 * (20260810034122_gate_lpe_content_blocks_read_on_review_status.sql) now
 * keeps unreviewed rows out of any non-admin session regardless of whether
 * retrieval code filters on it too.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface Embedder {
  /** Returns a 1536-dim embedding for the given text. */
  embed(text: string): Promise<number[]>;
}

export interface EmbedRunResult {
  embedded: number;
  skipped: number;
  reason?: string;
}

export async function populateContentEmbeddings(
  embedder?: Embedder,
): Promise<EmbedRunResult> {
  if (!embedder) {
    return { embedded: 0, skipped: 0, reason: "no_embedder_configured" };
  }

  const svc = createServiceRoleClient();
  const { data: blocks } = await svc
    .from("lpe_content_blocks")
    .select("id, title, body_md")
    .is("embedding", null);

  if (!blocks?.length) return { embedded: 0, skipped: 0, reason: "nothing_to_embed" };

  let embedded = 0;
  let skipped = 0;
  for (const b of blocks) {
    try {
      const vector = await embedder.embed(`${b.title}\n\n${b.body_md}`);
      // pgvector accepts the JSON array literal form for a vector column.
      const { error } = await svc
        .from("lpe_content_blocks")
        .update({ embedding: JSON.stringify(vector) })
        .eq("id", b.id);
      if (error) skipped++;
      else embedded++;
    } catch {
      skipped++;
    }
  }
  return { embedded, skipped };
}
