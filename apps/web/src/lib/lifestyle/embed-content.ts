import "server-only";
/**
 * Content-embedding population for pgvector personalisation (spec §11).
 *
 * Pluggable embedder. With no provider configured (`LIFESTYLE_EMBEDDING_MODEL`
 * unset) this is a graceful no-op that reports why — retrieval falls back to the
 * condition/module/risk tags until a real embedding provider + a clinician-vetted
 * content library exist. Wiring a provider = implement `Embedder` and pass it in;
 * nothing else changes.
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
