/**
 * S52 on the web: the crisis path (7.8), clarifying questions in the graph (7.11), memory reads (7.12). The model is a stub that fails the
 * test if it is touched, so "no model call" is proved.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAnthropic } from "@langchain/anthropic";
import { SELF_HARM_REPLY, type Database } from "@tarragon/shared";

const logAiCoachEscalation = jest.fn(async () => ({ clinicianAlertId: "a1", escalationId: "e1", careMessageThreadId: "t1" }));
const pageOnCallForSelfHarm = jest.fn(async () => true);
const emergencyAddendumFor = jest.fn(async () => "Hospitals we know of near you:\n- General Hospital Ikeja (Ikeja)");
jest.mock("./escalate", () => ({ logAiCoachEscalation, logAiCoachReviewFlag: jest.fn(async () => ({ clinicianAlertId: "a2" })) }));
jest.mock("./emergency-page", () => ({ pageOnCallForSelfHarm }));
jest.mock("./nearest-hospital", () => ({ ...(jest.requireActual("./nearest-hospital") as object), emergencyAddendumFor }));

import { buildCoachGraph } from "./graph";
import { CLARIFY_LEAD_IN } from "./clarify";
import { EMERGENCY_SAFETY_REPLY } from "./prompts";
import { loadAssistantMemory, memoryContextLine } from "./memory";
import { rankHospitals, normaliseState } from "@tarragon/shared";

function neverCalledModel() {
  const touched = jest.fn();
  const model = new Proxy({}, { get() { touched(); throw new Error("the model must not be reached"); } }) as unknown as ChatAnthropic;
  return { model, touched };
}
function graphWith() {
  const supabase = { from: jest.fn(() => ({ insert: jest.fn(async () => ({ error: null })) })) } as unknown as SupabaseClient<Database>;
  const { model, touched } = neverCalledModel();
  return { graph: buildCoachGraph({ supabase, getServiceRoleSupabase: () => supabase, model }), touched };
}
const base = { profileId: "p1", organisationId: "o1", conversationId: "c1", priorMessages: [] };

describe("the crisis path (7.8, INV-05, INV-06)", () => {
  it("an emergency reply is the fixed copy plus the nearest hospitals, with no model call", async () => {
    const { graph, touched } = graphWith();
    const out = await graph.invoke({ ...base, incomingMessage: "I have crushing chest pain" });
    expect(out.reply.startsWith(EMERGENCY_SAFETY_REPLY)).toBe(true);
    expect(out.reply).toContain("General Hospital Ikeja");
    expect(out.tier).toBe("emergency");
    expect(touched).not.toHaveBeenCalled();
    expect(pageOnCallForSelfHarm).not.toHaveBeenCalled();
  });

  it("self-harm wording gets its own copy, the nearest hospital, the escalation AND an on-call page, with no model call", async () => {
    pageOnCallForSelfHarm.mockClear();
    const { graph, touched } = graphWith();
    const out = await graph.invoke({ ...base, incomingMessage: "I want to kill myself" });
    expect(out.reply.startsWith(SELF_HARM_REPLY)).toBe(true);
    expect(out.reply).not.toContain(EMERGENCY_SAFETY_REPLY);
    expect(out.reply).toContain("General Hospital Ikeja");
    expect(logAiCoachEscalation).toHaveBeenCalled();
    expect(pageOnCallForSelfHarm).toHaveBeenCalledTimes(1);
    expect(touched).not.toHaveBeenCalled();
  });

  it("the escalation starts at once, never behind a slow hospital lookup", async () => {
    logAiCoachEscalation.mockClear();
    let release: (v: string) => void = () => undefined;
    emergencyAddendumFor.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    const { graph } = graphWith();
    const running = graph.invoke({ ...base, incomingMessage: "I have crushing chest pain" });
    await new Promise((r) => setTimeout(r, 20));
    // the lookup is still pending, and the escalation has already been raised
    expect(logAiCoachEscalation).toHaveBeenCalledTimes(1);
    release("Hospitals we know of near you:\n- General Hospital Ikeja (Ikeja)");
    const out = await running;
    expect(out.reply).toContain("General Hospital Ikeja");
  });

  it("the fixed copy stands alone when nothing about hospitals can be read (offline)", async () => {
    emergencyAddendumFor.mockResolvedValueOnce("");
    const { graph } = graphWith();
    const out = await graph.invoke({ ...base, incomingMessage: "I can't breathe" });
    expect(out.reply).toBe(EMERGENCY_SAFETY_REPLY);
  });
});

describe("clarifying questions in the graph (7.11)", () => {
  it("a vague one-liner gets a short question and no model call", async () => {
    const { graph, touched } = graphWith();
    const out = await graph.invoke({ ...base, incomingMessage: "it hurts" });
    expect(out.reply.startsWith(CLARIFY_LEAD_IN)).toBe(true);
    expect(touched).not.toHaveBeenCalled();
  });
  it("an emergency is never held up by a question", async () => {
    const { graph } = graphWith();
    const out = await graph.invoke({ ...base, incomingMessage: "chest pain, it hurts" });
    expect(out.tier).toBe("emergency");
    expect(out.reply.startsWith(CLARIFY_LEAD_IN)).toBe(false);
  });
  it("a dose request is refused, not questioned", async () => {
    const { graph } = graphWith();
    const out = await graph.invoke({ ...base, incomingMessage: "can I stop my tablets" });
    expect(out.reply.startsWith(CLARIFY_LEAD_IN)).toBe(false);
  });
});

describe("hospital ranking (shared by web and mobile)", () => {
  const rows = [
    { name: "B Clinic", city: "Yaba", address: null, contact_phone: null, verified: false },
    { name: "A Hospital", city: "Ikeja", address: "x", contact_phone: "1", verified: false },
    { name: "C Hospital", city: "Ikeja", address: null, contact_phone: null, verified: true },
  ];
  it("puts the patient's own city first, then verified, then by name; never by anything else", () => {
    expect(rankHospitals(rows, "ikeja", 3).map((h) => h.name)).toEqual(["C Hospital", "A Hospital", "B Clinic"]);
  });
  it("respects the limit and treats 'Lagos State' as 'lagos'", () => {
    expect(rankHospitals(rows, null, 1)).toHaveLength(1);
    expect(normaliseState("Lagos State")).toBe("lagos");
    expect(normaliseState("  ")).toBeNull();
  });
});

describe("memory reads (7.12)", () => {
  it("returns lines only from the database function, and nothing on any error", async () => {
    const ok = { rpc: jest.fn(async () => ({ data: [{ kind: "goal", text: "walk after dinner" }, { kind: "x", text: "ignored" }, { kind: "preference", text: "  " }], error: null })) } as unknown as SupabaseClient<Database>;
    expect(await loadAssistantMemory(ok)).toEqual([{ kind: "goal", text: "walk after dinner" }]);
    const bad = { rpc: jest.fn(async () => ({ data: null, error: { message: "x" } })) } as unknown as SupabaseClient<Database>;
    expect(await loadAssistantMemory(bad)).toEqual([]);
    const thrown = { rpc: jest.fn(async () => { throw new Error("down"); }) } as unknown as SupabaseClient<Database>;
    expect(await loadAssistantMemory(thrown)).toEqual([]);
  });
  it("frames memory as the patient's own words that never change a safety rule", () => {
    const line = memoryContextLine([{ kind: "goal", text: "walk after dinner" }]) ?? "";
    expect(line).toMatch(/never change a safety rule/);
    expect(memoryContextLine([])).toBeNull();
  });
  it("SCAN: nothing in the AI path selects assistant_memory_items directly", () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "memory-actions.ts")
      .filter((f) => !statSync(join(dir, f)).isDirectory())
      .filter((f) => /from\(\s*["']assistant_memory_items["']/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
