import { describe, it, expect, jest } from "@jest/globals";
import { createVoyageEmbedder } from "./voyage-embedder";

/**
 * Real finding (2026-09-17, AI-009 evaluation): the original
 * EXPECTED_DIMENSIONS (1536) was never exercised against a real Voyage
 * account and turned out to be rejected outright by the real API for
 * voyage-3-large ("accepted values ... are [256, 512, 1024, 2048]"). Fixed
 * to 1024 (Voyage's own default), with the matching DB columns migrated in
 * the same pass. These tests lock in the corrected contract with a mocked
 * fetch -- no real network call, no API key needed to run in CI.
 */
function fakeFetch(status: number, body: unknown): typeof fetch {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe("createVoyageEmbedder", () => {
  it("returns the embedding vector on a real-shaped 1024-dim success response", async () => {
    const vector = new Array(1024).fill(0.01);
    const fetchImpl = fakeFetch(200, { data: [{ embedding: vector }] });
    const embedder = createVoyageEmbedder("test-key", { fetchImpl });

    const result = await embedder.embed("hello");

    expect(result).toHaveLength(1024);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({
        body: expect.stringContaining('"output_dimension":1024') as unknown as string,
      })
    );
  });

  it("throws a specific, readable error when Voyage returns the wrong dimension", async () => {
    const wrongSizeVector = new Array(1536).fill(0.01);
    const fetchImpl = fakeFetch(200, { data: [{ embedding: wrongSizeVector }] });
    const embedder = createVoyageEmbedder("test-key", { fetchImpl });

    await expect(embedder.embed("hello")).rejects.toThrow(/1536-dim embedding/);
  });

  it("throws when Voyage rejects the request (e.g. an unsupported output_dimension, as it did for 1536)", async () => {
    const fetchImpl = fakeFetch(400, {
      detail: "Value '1536' supplied for argument 'output_dimension' is not valid -- accepted values for 'voyage-3-large' are [256, 512, 1024, 2048].",
    });
    const embedder = createVoyageEmbedder("test-key", { fetchImpl });

    await expect(embedder.embed("hello")).rejects.toThrow(/Voyage embeddings request failed \(400\)/);
  });
});
