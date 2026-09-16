import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { generateDraftReply } from "./generate-draft-reply";
import { __clearAiGovernanceCache } from "@/lib/ai-governance";

/**
 * AI-014 ran in production with no ai_systems row at all until 2026-09-16 —
 * no kill switch, no audit trail, no guardrail record — despite drafting text
 * a non-clinical Care Coordinator may send to a patient. These tests exist to
 * prove the two halves of that gap are actually closed, not merely wired:
 * that switching AI-014 off really does stop the model being reached, and
 * that a normal run really does land in ai_interaction_log.
 *
 * Deliberately no test of the drafting quality itself — that is an evaluation
 * suite's job, and AI-014 has none yet (visible as an outstanding acceptance
 * criterion on the governance console, which is where it belongs).
 */

const MESSAGES = [
  { author_role: "patient", body: "Hi, just confirming my appointment time", created_at: "2026-09-16T09:00:00Z" },
];

interface Harness {
  supabase: SupabaseClient<Database>;
  service: SupabaseClient<Database>;
  rpcCalls: string[];
  upserts: Record<string, unknown>[];
}

function harness(opts: { enabled: boolean }): Harness {
  const rpcCalls: string[] = [];
  const upserts: Record<string, unknown>[] = [];

  const rpc = jest.fn(async (fn: string) => {
    rpcCalls.push(fn);
    if (fn === "ai_runtime_config") {
      return {
        data: {
          registered: true,
          system_code: "AI-014",
          system_id: "00000000-0000-0000-0000-000000000014",
          name: "Care Coordinator draft reply",
          enabled: opts.enabled,
          runtime_governed: true,
          lifecycle_status: "live",
          risk_class: "high",
          autonomy_level: "assist",
          clinically_meaningful: true,
          fallback_behaviour: "The Care Coordinator writes the reply themselves.",
          disabled_reason: opts.enabled ? null : "Paused by the Clinical Director.",
          expected_model_identifier: "claude-haiku-4-5",
          prompt: null,
          guardrails: [],
          knowledge_sources: [],
        },
        error: null,
      };
    }
    if (fn === "record_ai_interaction") {
      return { data: "11111111-1111-1111-1111-111111111111", error: null };
    }
    return { data: null, error: null };
  });

  // buildDraftReplySnapshot reads care_message_threads then care_messages;
  // only the two query shapes it actually issues are faked here.
  const from = jest.fn((table: string) => {
    if (table === "care_message_threads") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { subject: "Checking in" }, error: null }) }),
        }),
      };
    }
    if (table === "care_messages") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: async () => ({ data: MESSAGES, error: null }) }),
          }),
        }),
      };
    }
    return {
      upsert: async (row: Record<string, unknown>) => {
        upserts.push(row);
        return { data: null, error: null };
      },
    };
  });

  const supabase = { rpc, from } as unknown as SupabaseClient<Database>;
  return { supabase, service: supabase, rpcCalls, upserts };
}

describe("generateDraftReply — AI-014 governance", () => {
  beforeEach(() => {
    __clearAiGovernanceCache();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("never reaches the model when AI-014 is switched off", async () => {
    const h = harness({ enabled: false });
    // A model that would throw loudly if it were ever invoked, so "the kill
    // switch worked" cannot be confused with "the model happened to fail".
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error("the model must not be reached when AI-014 is off");
        },
      }),
    } as never;

    const result = await generateDraftReply(
      h.supabase,
      () => h.service,
      { threadId: "t-1", organisationId: "org-1", patientId: "p-1" },
      model,
    );

    expect(result.status).toBe("failed");
    // 40.11: the switched-off outcome is itself an audited interaction.
    expect(h.rpcCalls).toContain("record_ai_interaction");
  });

  it("reaches the model and audits the interaction when AI-014 is on", async () => {
    // The control for the test above — without it, a wrapper that refused
    // every call would pass the kill-switch test perfectly.
    const h = harness({ enabled: true });
    const invoke = jest.fn(async () => ({
      draftReply: "Happy to confirm — your appointment is still booked.",
      needsClinicalReview: false,
      reviewReason: null,
    }));
    const model = { withStructuredOutput: () => ({ invoke }) } as never;

    const result = await generateDraftReply(
      h.supabase,
      () => h.service,
      { threadId: "t-1", organisationId: "org-1", patientId: "p-1" },
      model,
    );

    expect(result.status).toBe("generated");
    expect(invoke).toHaveBeenCalled();
    expect(h.rpcCalls).toContain("record_ai_interaction");
  });
});
