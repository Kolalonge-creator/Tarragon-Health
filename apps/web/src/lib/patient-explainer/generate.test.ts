import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { generatePatientExplanation } from "./generate";
import { __clearAiGovernanceCache } from "@/lib/ai-governance";

/**
 * Covers the "real finding" in docs/AI_002_015_EVALUATION_SCOPE.md: the
 * medication-explanation path (kind = "medication") used to be a bare
 * try/catch around a direct ChatAnthropic call, wired through neither
 * runGovernedAi nor decideAiGovernance. Switching AI-003 off in the console
 * did nothing to it -- it kept calling Claude regardless. These tests prove
 * the fix: the medication path now goes through the exact same governance
 * gate the other six `kind`s already used (generateResultExplanation), by
 * asserting the kill switch actually stops it and the audit trail actually
 * records it -- not just that the code now imports runGovernedAi.
 */

interface RpcCall {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    registered: true,
    system_code: "AI-003",
    system_id: "00000000-0000-0000-0000-000000000003",
    name: "Patient result explainer",
    enabled: true,
    runtime_governed: true,
    lifecycle_status: "live",
    risk_class: "moderate",
    autonomy_level: "inform_only",
    clinically_meaningful: true,
    fallback_behaviour: "The patient sees the result without a plain-language explanation.",
    disabled_reason: null,
    expected_model_identifier: "claude-haiku-4-5",
    prompt: null,
    guardrails: [],
    knowledge_sources: [],
    ...overrides,
  };
}

function chainable(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order", "limit", "is", "in", "upsert"]) {
    obj[method] = jest.fn(() => obj);
  }
  obj.single = jest.fn(async () => result);
  obj.maybeSingle = jest.fn(async () => result);
  obj.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return obj;
}

function makeSupabase(opts: {
  medicationRow: Record<string, unknown> | null;
  runtimeConfig: unknown;
  rpcCalls: RpcCall[];
  fromCalls: { table: string; payload?: unknown }[];
}): SupabaseClient<Database> {
  return {
    rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
      opts.rpcCalls.push({ fn, args });
      if (fn === "ai_runtime_config") return { data: opts.runtimeConfig, error: null };
      if (fn === "record_ai_interaction") {
        return { data: "11111111-1111-1111-1111-111111111111", error: null };
      }
      return { data: null, error: null };
    }),
    from: jest.fn((table: string) => {
      if (table === "medications") {
        return chainable({ data: opts.medicationRow, error: null });
      }
      // patient_result_explanations upsert -- capture the payload, mirroring
      // fakeSupabaseFrom's per-table dispatch but also recording writes.
      const c = chainable({ data: null, error: null });
      const originalUpsert = c.upsert as jest.Mock;
      c.upsert = jest.fn((payload: unknown) => {
        opts.fromCalls.push({ table, payload });
        return originalUpsert(payload);
      });
      return c;
    }),
  } as unknown as SupabaseClient<Database>;
}

function fakeModel(reply: () => Promise<{ explanation: string }>): ChatAnthropic {
  return {
    withStructuredOutput: () => ({ invoke: reply }),
  } as unknown as ChatAnthropic;
}

const MEDICATION_ROW = {
  drug_name: "Amlodipine",
  dose: "5mg",
  frequency: "once daily",
  route: "oral",
  indication: "hypertension",
  instructions: "Take in the morning",
  source: "clinician",
  created_at: "2026-06-01T00:00:00.000Z",
};

const PARAMS = {
  patientId: "22222222-2222-2222-2222-222222222222",
  organisationId: "33333333-3333-3333-3333-333333333333",
  kind: "medication" as const,
  subjectKey: "44444444-4444-4444-4444-444444444444",
  label: "Amlodipine",
  language: "en",
};

describe("generatePatientExplanation — medication path governance (AI-003)", () => {
  beforeEach(() => {
    __clearAiGovernanceCache();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls the model and records a completed audit row when AI-003 is enabled", async () => {
    const rpcCalls: RpcCall[] = [];
    const fromCalls: { table: string; payload?: unknown }[] = [];
    const supabase = makeSupabase({
      medicationRow: MEDICATION_ROW,
      runtimeConfig: baseConfig(),
      rpcCalls,
      fromCalls,
    });
    const invoke = jest.fn(async () => ({ explanation: "This medication helps manage your blood pressure." }));

    const result = await generatePatientExplanation(supabase, () => supabase, PARAMS, fakeModel(invoke));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("generated");
    expect(result.explanation).toBe("This medication helps manage your blood pressure.");

    const audit = rpcCalls.find((c) => c.fn === "record_ai_interaction")?.args;
    expect(audit?.p_status).toBe("completed");
    expect(audit?.p_system_code).toBe("AI-003");
    expect(audit?.p_input_category).toBe("result_explanation:medication");
    expect(audit?.p_subject_profile_id).toBe(PARAMS.patientId);

    const upsertCall = fromCalls.find((c) => c.table === "patient_result_explanations");
    expect((upsertCall?.payload as Record<string, unknown>)?.status).toBe("generated");
  });

  it("never calls the model, and audits a fallback, when AI-003 is switched off (the fix for the real finding)", async () => {
    const rpcCalls: RpcCall[] = [];
    const fromCalls: { table: string; payload?: unknown }[] = [];
    const supabase = makeSupabase({
      medicationRow: MEDICATION_ROW,
      runtimeConfig: baseConfig({ enabled: false, disabled_reason: "Paused for review" }),
      rpcCalls,
      fromCalls,
    });
    const invoke = jest.fn(async () => ({ explanation: "should never be called" }));

    const result = await generatePatientExplanation(supabase, () => supabase, PARAMS, fakeModel(invoke));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");

    const audit = rpcCalls.find((c) => c.fn === "record_ai_interaction")?.args;
    expect(audit?.p_status).toBe("fallback");
    expect(audit?.p_system_code).toBe("AI-003");
    expect(String(audit?.p_fallback_reason ?? "")).toContain("switched off");

    const upsertCall = fromCalls.find((c) => c.table === "patient_result_explanations");
    expect((upsertCall?.payload as Record<string, unknown>)?.status).toBe("failed");
  });

  it("falls back to a failed record, without throwing, when the model call itself errors", async () => {
    const rpcCalls: RpcCall[] = [];
    const fromCalls: { table: string; payload?: unknown }[] = [];
    const supabase = makeSupabase({
      medicationRow: MEDICATION_ROW,
      runtimeConfig: baseConfig(),
      rpcCalls,
      fromCalls,
    });
    const invoke = jest.fn(async () => {
      throw new Error("model unreachable");
    });

    const result = await generatePatientExplanation(supabase, () => supabase, PARAMS, fakeModel(invoke));

    expect(result.status).toBe("failed");
    const audit = rpcCalls.find((c) => c.fn === "record_ai_interaction")?.args;
    expect(audit?.p_status).toBe("fallback");
    expect(String(audit?.p_error_message ?? "")).toContain("model unreachable");
  });
});
