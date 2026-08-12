import "server-only";
import type { Embedder } from "./embed-content";

/**
 * Voyage AI embeddings client — the `Embedder` implementation `embed-content.ts`
 * was scaffolded to accept.
 *
 * Provider choice: Voyage AI, not OpenAI. This platform's entire AI surface
 * (AI Coach chat, lab-report extraction, medication-pack/meal vision, case
 * briefs, the patient explainer) runs on Claude via `@langchain/anthropic` —
 * there is no OpenAI dependency anywhere in this codebase. Claude has no
 * first-party embeddings API, and Voyage AI is Anthropic's own recommended
 * embedding partner, so this keeps the platform on one AI vendor
 * relationship instead of introducing a second, unrelated one just for
 * embeddings (CLAUDE.md: "AI workflows: LangGraph.js + Claude API" — Stack A,
 * do not relitigate).
 *
 * Mirrors packages/shared/src/ml-client.ts's contract for an external AI
 * HTTP call: AbortController timeout, `createVoyageEmbedderFromEnv` returns
 * `null` (not a throwing client) when `VOYAGE_API_KEY` is unset, so
 * `populateContentEmbeddings` stays on its existing graceful
 * "no_embedder_configured" no-op path with zero code changes there.
 *
 * VERIFY BEFORE TRUSTING THIS LIVE: no VOYAGE_API_KEY exists in this
 * environment, so the model name and `output_dimension` parameter below have
 * NOT been exercised against a real Voyage account — cross-check against
 * Voyage's current embeddings API docs once a real key is configured. The
 * dimension check below is a deliberate loud failure, not a guess dressed up
 * as a guarantee: if the model/config drifts from 1536 dimensions, every
 * embed() call throws a specific, readable error instead of pgvector
 * rejecting the insert with an opaque type-mismatch error three layers away.
 */

const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_TIMEOUT_MS = 10_000;
/** Must match lpe_content_blocks.embedding's `vector(1536)` column exactly
 * (20260719124000_lpe_content_embeddings.sql). */
const EXPECTED_DIMENSIONS = 1536;

interface VoyageEmbeddingsResponse {
  data?: { embedding: number[] }[];
}

export function createVoyageEmbedder(
  apiKey: string,
  opts: { model?: string; fetchImpl?: typeof fetch } = {},
): Embedder {
  const model = opts.model ?? "voyage-3-large";
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  return {
    async embed(text: string): Promise<number[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);

      try {
        const response = await fetchImpl(VOYAGE_EMBEDDINGS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: text,
            model,
            input_type: "document",
            output_dimension: EXPECTED_DIMENSIONS,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`Voyage embeddings request failed (${response.status}): ${detail}`);
        }

        const payload = (await response.json()) as VoyageEmbeddingsResponse;
        const vector = payload.data?.[0]?.embedding;
        if (!vector) {
          throw new Error("Voyage embeddings response had no embedding vector");
        }
        if (vector.length !== EXPECTED_DIMENSIONS) {
          throw new Error(
            `Voyage returned a ${vector.length}-dim embedding for model "${model}", expected ` +
              `${EXPECTED_DIMENSIONS} to match lpe_content_blocks.embedding's vector(1536) column. ` +
              `Check the model name and output_dimension support before retrying.`,
          );
        }
        return vector;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Build a Voyage embedder from `VOYAGE_API_KEY`, or `null` if unset —
 * callers pass this straight to `populateContentEmbeddings(embedder?)`,
 * which already treats `undefined`/`null` as "not configured yet". */
export function createVoyageEmbedderFromEnv(
  env: Record<string, string | undefined> = process.env,
): Embedder | null {
  const apiKey = env.VOYAGE_API_KEY;
  if (!apiKey) return null;
  return createVoyageEmbedder(apiKey, { model: env.VOYAGE_EMBEDDING_MODEL });
}
