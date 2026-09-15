import { runGovernedAi } from "./run-governed";
import { __clearAiGovernanceCache, type AiGovernanceClient } from "./registry";
import type { AiRuntimeConfig } from "./types";

interface RpcCall {
  readonly fn: string;
  readonly args: Record<string, unknown>;
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
    fallback_behaviour: "The deterministic keyword guardrail still runs.",
    disabled_reason: null,
    expected_model_identifier: "claude-sonnet-5",
    prompt: null,
    guardrails: [],
    knowledge_sources: [],
    ...overrides,
  };
}

function client(
  config: AiRuntimeConfig | { registered: false; system_code: string }
): AiGovernanceClient & { rpcCalls: RpcCall[] } {
  const rpcCalls: RpcCall[] = [];
  return {
    rpcCalls,
    rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "ai_runtime_config") return { data: config, error: null };
      if (fn === "record_ai_interaction") {
        return { data: "11111111-1111-1111-1111-111111111111", error: null };
      }
      return { data: null, error: null };
    }),
  } as unknown as AiGovernanceClient & { rpcCalls: RpcCall[] };
}

const auditFor = (calls: RpcCall[]) => calls.find((c) => c.fn === "record_ai_interaction")?.args;

describe("runGovernedAi", () => {
  beforeEach(() => {
    __clearAiGovernanceCache();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("runs the AI path when the system is enabled, and audits the outcome", async () => {
    const supabase = client(registered());
    const run = jest.fn(async () => ({ value: "answer", modelIdentifier: "claude-sonnet-5" }));
    const fallback = jest.fn(() => "fallback");

    const result = await runGovernedAi({
      supabase,
      systemCode: "AI-001",
      inputCategory: "symptom_question",
      subjectProfileId: "22222222-2222-2222-2222-222222222222",
      run,
      fallback,
    });

    expect(result.status).toBe("completed");
    expect(result.value).toBe("answer");
    expect(fallback).not.toHaveBeenCalled();

    const audit = auditFor(supabase.rpcCalls);
    expect(audit?.p_status).toBe("completed");
    expect(audit?.p_model_identifier).toBe("claude-sonnet-5");
    expect(audit?.p_input_category).toBe("symptom_question");
  });

  it("runs the fallback and never reaches the model when the kill switch is thrown", async () => {
    const supabase = client(registered({ enabled: false, disabled_reason: "Suspended." }));
    const run = jest.fn(async () => ({ value: "answer", modelIdentifier: "claude-sonnet-5" }));
    const fallback = jest.fn(() => "fallback");

    const result = await runGovernedAi({
      supabase,
      systemCode: "AI-001",
      inputCategory: "symptom_question",
      run,
      fallback,
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.status).toBe("fallback");
    expect(result.value).toBe("fallback");
    expect(result.fallbackReason).toBe("kill_switch");
    expect(fallback).toHaveBeenCalledWith("kill_switch");

    // 40.18: a fallback is still an audited interaction, and it says why.
    const audit = auditFor(supabase.rpcCalls);
    expect(audit?.p_status).toBe("fallback");
    expect(String(audit?.p_fallback_reason)).toContain("Suspended.");
  });

  it("falls back rather than throwing when the AI path fails", async () => {
    const supabase = client(registered());
    const run = jest.fn(async () => {
      throw new Error("model timed out");
    });
    const fallback = jest.fn(() => "fallback");

    const result = await runGovernedAi({
      supabase,
      systemCode: "AI-001",
      inputCategory: "symptom_question",
      run,
      fallback,
    });

    expect(result.status).toBe("fallback");
    expect(result.fallbackReason).toBe("ai_error");
    expect(auditFor(supabase.rpcCalls)?.p_error_message).toBe("model timed out");
  });

  it("records a guardrail-suppressed answer as blocked, not completed", async () => {
    const supabase = client(registered());

    const result = await runGovernedAi({
      supabase,
      systemCode: "AI-001",
      inputCategory: "symptom_question",
      run: async () => ({
        value: "safety reply",
        modelIdentifier: "claude-sonnet-5",
        blockedByGuardrail: true,
        guardrailsTriggered: ["emergency_keyword_escalation"],
        safetyClassification: "emergency" as const,
      }),
      fallback: () => "fallback",
    });

    expect(result.status).toBe("blocked");
    const audit = auditFor(supabase.rpcCalls);
    expect(audit?.p_status).toBe("blocked");
    expect(audit?.p_guardrails_triggered).toEqual(["emergency_keyword_escalation"]);
    expect(audit?.p_safety_classification).toBe("emergency");
  });

  it("still returns an answer when the audit write itself fails", async () => {
    // Losing the record is bad; losing the patient's answer as well is worse.
    const supabase = {
      rpc: jest.fn(async (fn: string) => {
        if (fn === "ai_runtime_config") return { data: registered(), error: null };
        return { data: null, error: { message: "audit table unreachable" } };
      }),
    } as unknown as AiGovernanceClient;

    const result = await runGovernedAi({
      supabase,
      systemCode: "AI-001",
      inputCategory: "symptom_question",
      run: async () => ({ value: "answer", modelIdentifier: "claude-sonnet-5" }),
      fallback: () => "fallback",
    });

    expect(result.status).toBe("completed");
    expect(result.value).toBe("answer");
    expect(result.interactionId).toBeNull();
  });

  it("passes the governed prompt version through to the audit row", async () => {
    const supabase = client(
      registered({
        prompt: {
          prompt_version_id: "33333333-3333-3333-3333-333333333333",
          version: 2,
          system_prompt: "governed",
          safety_instructions: "safety",
          retrieval_config: {},
          output_constraints: {},
          model_config: {},
        },
      })
    );

    await runGovernedAi({
      supabase,
      systemCode: "AI-001",
      inputCategory: "symptom_question",
      run: async (ctx) => {
        expect(ctx.config?.prompt?.version).toBe(2);
        return { value: "answer", modelIdentifier: "claude-sonnet-5" };
      },
      fallback: () => "fallback",
    });

    expect(auditFor(supabase.rpcCalls)?.p_prompt_version_id).toBe(
      "33333333-3333-3333-3333-333333333333"
    );
  });
});
