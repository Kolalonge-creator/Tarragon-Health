import {
  decideAiGovernance,
  __clearAiGovernanceCache,
  type AiGovernanceClient,
} from "./registry";
import type { AiRuntimeConfig } from "./types";

type RpcResult = { data: unknown; error: { message: string } | null };

// Same shape the rest of this codebase uses for a fake Supabase client
// (lib/lifestyle/find-relevant-content.test.ts): the real rpc() signature is
// generic over every RPC in the schema, so a hand-written stub is cast in
// rather than structurally matched.
function client(responses: RpcResult[]): AiGovernanceClient & { rpc: jest.Mock } {
  let i = 0;
  return {
    rpc: jest.fn(async (_fn: string, _args: { p_system_code: string }) => {
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return next;
    }),
  } as unknown as AiGovernanceClient & { rpc: jest.Mock };
}

function registered(overrides: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  return {
    registered: true,
    system_code: "AI-001",
    system_id: "00000000-0000-0000-0000-000000000001",
    name: "AI Health Coach",
    enabled: true,
    runtime_governed: true,
    lifecycle_status: "live",
    risk_class: "high",
    autonomy_level: "assist",
    clinically_meaningful: true,
    fallback_behaviour: "Deterministic keyword guardrail still runs.",
    disabled_reason: null,
    expected_model_identifier: "claude-sonnet-5",
    prompt: null,
    guardrails: [],
    knowledge_sources: [],
    ...overrides,
  };
}

describe("decideAiGovernance", () => {
  beforeEach(() => {
    __clearAiGovernanceCache();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows an enabled system and hands back its governed config", async () => {
    const supabase = client([{ data: registered(), error: null }]);
    const decision = await decideAiGovernance(supabase, "AI-001");

    expect(decision.allow).toBe(true);
    expect(decision.config?.name).toBe("AI Health Coach");
  });

  it("blocks a system whose kill switch has been thrown, and says why", async () => {
    const supabase = client([
      {
        data: registered({ enabled: false, disabled_reason: "Under investigation after an incident." }),
        error: null,
      },
    ]);

    const decision = await decideAiGovernance(supabase, "AI-001");

    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("unreachable");
    expect(decision.reason).toBe("kill_switch");
    expect(decision.message).toBe("Under investigation after an incident.");
  });

  it("caches, so a second call in the same minute does not re-query", async () => {
    const supabase = client([{ data: registered(), error: null }]);

    await decideAiGovernance(supabase, "AI-001");
    await decideAiGovernance(supabase, "AI-001");

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps serving a thrown kill switch when the lookup later fails", async () => {
    // The important direction of the stale-while-unavailable rule: a system
    // a human switched off must stay off through a database blip.
    const supabase = client([
      { data: registered({ enabled: false, disabled_reason: "Switched off." }), error: null },
      { data: null, error: { message: "connection reset" } },
    ]);

    await decideAiGovernance(supabase, "AI-001");
    __clearAiGovernanceCacheFreshnessOnly();
    const second = await decideAiGovernance(supabase, "AI-001");

    expect(second.allow).toBe(false);
    if (second.allow) throw new Error("unreachable");
    expect(second.reason).toBe("kill_switch");
  });

  it("fails closed for a clinically meaningful system when governance is unreadable", async () => {
    const supabase = client([{ data: null, error: { message: "connection reset" } }]);

    const decision = await decideAiGovernance(supabase, "AI-001");

    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("unreachable");
    expect(decision.reason).toBe("governance_unavailable");
  });

  it("fails open for a low-risk system when governance is unreadable", async () => {
    // AI-008 is meal-photo nutrition estimation: no clinical threshold reads
    // it, so a transient governance outage must not switch it off.
    const supabase = client([{ data: null, error: { message: "connection reset" } }]);

    const decision = await decideAiGovernance(supabase, "AI-008");

    expect(decision.allow).toBe(true);
    expect(decision.config).toBeNull();
  });

  it("treats an unregistered clinically meaningful call site as a stop", async () => {
    const supabase = client([{ data: { registered: false, system_code: "AI-001" }, error: null }]);

    const decision = await decideAiGovernance(supabase, "AI-001");

    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("unreachable");
    expect(decision.reason).toBe("unregistered");
  });

  it("refuses to trust a config whose shape this build does not understand", async () => {
    const supabase = client([
      { data: { registered: true, system_code: "AI-001", enabled: "yes" }, error: null },
    ]);

    const decision = await decideAiGovernance(supabase, "AI-001");

    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("unreachable");
    expect(decision.reason).toBe("governance_unavailable");
  });
});

/**
 * Expires the cache's freshness window without dropping its contents, which
 * is the only way to exercise stale-while-unavailable without a fake clock.
 * Implemented by advancing Date.now past FRESH_MS but not STALE_MS.
 */
function __clearAiGovernanceCacheFreshnessOnly(): void {
  const realNow = Date.now;
  const shifted = realNow() + 90_000;
  jest.spyOn(Date, "now").mockImplementation(() => shifted);
}
