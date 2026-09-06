import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { Embedder } from "./embed-content";
import { findRelevantLifestyleContent } from "./find-relevant-content";
import { __clearAiGovernanceCache } from "@/lib/ai-governance";

/**
 * Retrieval now consults AI-009's governance record before embedding
 * anything, so a fake client has to answer `ai_runtime_config` as well as
 * `match_lpe_content_blocks`. `enabled` defaults to true here because that is
 * the normal state; the kill-switch case has its own test below.
 */
function fakeSupabase(
  rpcImpl: (...args: unknown[]) => unknown,
  governance: { enabled: boolean } = { enabled: true },
): SupabaseClient<Database> {
  const rpc = jest.fn((fn: unknown, ...rest: unknown[]) => {
    if (fn === "ai_runtime_config") {
      return Promise.resolve({
        data: {
          registered: true,
          system_code: "AI-009",
          system_id: "00000000-0000-0000-0000-000000000009",
          name: "Lifestyle content retrieval embeddings",
          enabled: governance.enabled,
          runtime_governed: true,
          lifecycle_status: "live",
          risk_class: "low",
          autonomy_level: "inform_only",
          clinically_meaningful: false,
          fallback_behaviour: "Retrieval is skipped.",
          disabled_reason: governance.enabled ? null : "Switched off for this test.",
          expected_model_identifier: "voyage-3-large",
          prompt: null,
          guardrails: [],
          knowledge_sources: [],
        },
        error: null,
      });
    }
    return rpcImpl(fn, ...rest);
  });
  return { rpc } as unknown as SupabaseClient<Database>;
}

/** The RPC calls that are not the governance lookup. */
const contentCalls = (supabase: SupabaseClient<Database>) =>
  (supabase.rpc as unknown as jest.Mock).mock.calls.filter(
    (c) => c[0] !== "ai_runtime_config",
  );

describe("findRelevantLifestyleContent", () => {
  beforeEach(() => __clearAiGovernanceCache());

  it("returns [] without calling the RPC when the embedder throws", async () => {
    const supabase = fakeSupabase(jest.fn());
    const embedder: Embedder = {
      embed: async () => {
        throw new Error("Voyage unreachable");
      },
    };

    const result = await findRelevantLifestyleContent(supabase, embedder, "some query");

    expect(result).toEqual([]);
    expect(contentCalls(supabase)).toHaveLength(0);
  });

  it("does not embed anything when AI-009 is switched off", async () => {
    // 40.17: the kill switch has to reach the embedding provider, not just
    // the surfaces that read from it.
    const supabase = fakeSupabase(jest.fn(), { enabled: false });
    const embed = jest.fn(async () => [0.1, 0.2, 0.3]);
    const embedder: Embedder = { embed };

    const result = await findRelevantLifestyleContent(supabase, embedder, "some query");

    expect(result).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
    expect(contentCalls(supabase)).toHaveLength(0);
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
