/**
 * Real-library check of what the AI Coach actually sends to Anthropic.
 *
 * Every other ai-coach suite mocks @langchain/*, so none of them notices a
 * LangChain upgrade that changes how a zod schema becomes a tool's
 * input_schema, how a tool call round-trips, or whether sampling params come
 * back. This one runs the real @langchain/anthropic + @langchain/core with only
 * the HTTP layer faked, and asserts on the captured request bodies. Added with
 * the 2026-11-05 move from LangChain 0.3 to 1.x (zod 3 copy removed).
 */
import { HumanMessage, SystemMessage, ToolMessage, type AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildAnthropicModel } from "./model";
import { buildPatientRecordTools } from "./tools";
import { buildReferralRequestTool } from "./referral-tool";

type Body = Record<string, unknown> & { tools?: { name: string; input_schema: Record<string, unknown> }[] };

const bodies: Body[] = [];
let nextReply: unknown;
const realFetch = globalThis.fetch;

function anthropicMessage(content: unknown[]) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);
    return new Response(JSON.stringify(nextReply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  bodies.length = 0;
});

// Building the tools never touches Supabase; only executing one does.
const fakeSupabase = {} as SupabaseClient<Database>;
function coachTools() {
  return [
    ...buildPatientRecordTools(fakeSupabase, "patient-1"),
    buildReferralRequestTool({
      patientSupabase: fakeSupabase,
      getServiceRoleSupabase: () => {
        throw new Error("must not be called while binding tools");
      },
      organisationId: "org-1",
      patientId: "patient-1",
      conversationId: "conv-1",
      onReferralRequested: () => {},
    }),
  ];
}

describe("LangChain request shape (real library, fake HTTP)", () => {
  it("sends every coach tool as an object input_schema and never sends sampling params", async () => {
    nextReply = anthropicMessage([{ type: "text", text: "ok" }]);
    await buildAnthropicModel().bindTools(coachTools()).invoke([new SystemMessage("s"), new HumanMessage("h")]);

    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    expect(body.tools?.length).toBe(coachTools().length);
    for (const t of body.tools ?? []) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).toHaveProperty("properties");
    }
    const referral = body.tools?.find((t) => t.name === "requestSpecialistReferral");
    expect(referral?.input_schema.required).toEqual(expect.arrayContaining(["specialistType", "reason"]));
  });

  it("round-trips a tool call into a tool_result the next request carries", async () => {
    nextReply = anthropicMessage([{ type: "tool_use", id: "tu_1", name: "lookup", input: { q: "bp" } }]);
    const lookup = z.object({ q: z.string() });
    const ai = (await buildAnthropicModel().bindTools([{ name: "lookup", description: "d", schema: lookup }]).invoke([new HumanMessage("h")])) as AIMessage;
    expect(ai.tool_calls).toEqual([expect.objectContaining({ name: "lookup", args: { q: "bp" }, id: "tu_1" })]);

    nextReply = anthropicMessage([{ type: "text", text: "done" }]);
    await buildAnthropicModel().invoke([new HumanMessage("h"), ai, new ToolMessage({ content: "120/80", tool_call_id: "tu_1", name: "lookup" })]);
    const messages = bodies[1].messages as { role: string; content: unknown }[];
    expect(messages.at(-1)).toEqual({ role: "user", content: [expect.objectContaining({ type: "tool_result", tool_use_id: "tu_1", content: "120/80" })] });
  });

  it("parses withStructuredOutput from a forced tool call", async () => {
    nextReply = anthropicMessage([{ type: "tool_use", id: "tu_2", name: "reply", input: { tier: "routine", reply: "hi" } }]);
    const schema = z.object({ tier: z.enum(["routine", "clinician_review"]), reply: z.string() });
    const result = await buildAnthropicModel().withStructuredOutput(schema, { name: "reply" }).invoke([new HumanMessage("h")]);
    expect(result).toEqual({ tier: "routine", reply: "hi" });
    expect(bodies[0].tool_choice).toEqual({ type: "tool", name: "reply" });
  });
});
