import { describe, it, expect, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { Embedder } from "./embed-content";
import { findRelevantLifestyleContent } from "./find-relevant-content";

function fakeSupabase(rpcImpl: (...args: unknown[]) => unknown): SupabaseClient<Database> {
  return { rpc: jest.fn(rpcImpl) } as unknown as SupabaseClient<Database>;
}

describe("findRelevantLifestyleContent", () => {
  it("returns [] without calling the RPC when the embedder throws", async () => {
    const rpc = jest.fn();
    const supabase = fakeSupabase(rpc);
    const embedder: Embedder = {
      embed: async () => {
        throw new Error("Voyage unreachable");
      },
    };

    const result = await findRelevantLifestyleContent(supabase, embedder, "some query");

    expect(result).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns [] when the RPC call errors", async () => {
    const embedder: Embedder = { embed: async () => [0.1, 0.2, 0.3] };
    const supabase = fakeSupabase(async () => ({ data: null, error: { message: "boom" } }));

    const result = await findRelevantLifestyleContent(supabase, embedder, "some query");

    expect(result).toEqual([]);
  });

  it("returns [] when the RPC returns no data", async () => {
    const embedder: Embedder = { embed: async () => [0.1, 0.2, 0.3] };
    const supabase = fakeSupabase(async () => ({ data: null, error: null }));

    const result = await findRelevantLifestyleContent(supabase, embedder, "some query");

    expect(result).toEqual([]);
  });

  it("maps RPC rows to RelevantContentBlock on success, and forwards match/filter args", async () => {
    const embedVector = [0.1, 0.2, 0.3];
    const embedder: Embedder = { embed: async () => embedVector };
    const rpc = jest.fn(async (..._args: unknown[]) => ({
      data: [
        {
          id: "abc",
          key: "htn.diet.less_salt_cooking",
          title: "Cooking with less salt, still tasty",
          body_md: "Try building flavour with onion, garlic...",
          condition: "hypertension",
          module: "diet",
          similarity: 0.87,
        },
      ],
      error: null,
    }));
    const supabase = fakeSupabase(rpc);

    const result = await findRelevantLifestyleContent(supabase, embedder, "salt and blood pressure", {
      matchCount: 2,
      conditionFilter: "hypertension",
    });

    expect(result).toEqual([
      {
        id: "abc",
        key: "htn.diet.less_salt_cooking",
        title: "Cooking with less salt, still tasty",
        bodyMd: "Try building flavour with onion, garlic...",
        condition: "hypertension",
        module: "diet",
        similarity: 0.87,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("match_lpe_content_blocks", {
      query_embedding: JSON.stringify(embedVector),
      match_count: 2,
      filter_condition: "hypertension",
      filter_module: undefined,
    });
  });
});
