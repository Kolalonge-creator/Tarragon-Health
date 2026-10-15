import { describe, expect, it, jest } from "@jest/globals";
import { GLUCOSE_CARE_V1, type GlucoseInput } from "./index";
import {
  makeObservationHandler,
  TRIAGE_HANDLER_KEY,
  type GlucoseRuleSetForGrading,
  type GlucoseTriageContext,
  type TriagePorts,
} from "../../../supabase/functions/_shared/triage/observation-handler";
import { triagePorts, type RpcClient } from "../../../supabase/functions/process-events/triage-ports";
import type { BusEvent } from "../../../supabase/functions/_shared/event-bus/dispatch";
import type { TriageResult } from "./types";

/** Plan item R2: the glucose half of the server triage handler, fed the JSON shape triage_context_for_glucose_observation returns. */
const NOW = "2026-10-13T10:00:00.000Z";
const glucoseInput = (mmol: number, over: Partial<GlucoseInput> = {}, symptoms: GlucoseInput["trigger"]["symptoms"] = []): GlucoseInput => ({
  trigger: { type: "glucose", reading: { mmol, takenAt: NOW, context: "fasting" }, symptoms },
  diabetesType: "type_2",
  pregnant: false,
  ageYears: 50,
  now: NOW,
  ...over,
});
function event(payload: Record<string, unknown>): BusEvent {
  return {
    deliveryId: "d1", leaseToken: "l1", attempt: 1, eventId: "e1", eventType: "observation.recorded", eventVersion: 1,
    organisationId: "o1", patientId: "p1", aggregateType: "observation", aggregateId: "obs1", payload, priority: "normal",
    isTest: true, occurredAt: NOW, subscriberKey: TRIAGE_HANDLER_KEY, handlerKey: TRIAGE_HANDLER_KEY,
  };
}
const ctx = { once: async () => true };
const draft: GlucoseRuleSetForGrading = { id: "grs1", status: "draft", rules: GLUCOSE_CARE_V1 };

function ports(over: Partial<TriagePorts> = {}) {
  const recorded: { observationId: string; result: TriageResult; ruleSetId: string; causationId: string; basis: string }[] = [];
  const p: TriagePorts = {
    loadContext: jest.fn(async () => ({ found: false })),
    loadRuleSet: jest.fn(async () => null),
    record: jest.fn(async () => undefined),
    loadGlucoseContext: jest.fn(async () => ({ found: true, input: glucoseInput(6) }) as GlucoseTriageContext),
    loadGlucoseRuleSet: jest.fn(async () => draft),
    recordGlucose: jest.fn(async (a: (typeof recorded)[number]) => void recorded.push(a)),
    ...over,
  };
  return { p, recorded };
}

describe("the glucose branch of the observation handler", () => {
  it("a glucose reading from a patient with no date of birth or no diabetes record (keys missing from the JSON, as jsonb_strip_nulls sends them) is graded, never rejected as invalid input", async () => {
    const { ageYears: _a, diabetesType: _d, ...stripped } = glucoseInput(2.6);
    const { p, recorded } = ports({ loadGlucoseContext: async () => ({ found: true, input: stripped as unknown as GlucoseInput }) });
    await makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }), ctx);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.result.status).toBe("graded");
    expect(recorded[0]?.result.grade).toBe("red");
  });

  it("grades a glucose event with the glucose rule set and records it with the rule set and the event as cause, never touching the blood pressure ports", async () => {
    const { p, recorded } = ports();
    await makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }), ctx);
    expect(p.loadGlucoseRuleSet).toHaveBeenCalledWith("glucose_care_triage");
    expect(p.loadContext).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
    expect(recorded[0]).toMatchObject({ observationId: "obs1", ruleSetId: "grs1", causationId: "e1", basis: "" });
    expect(recorded[0]?.result).toMatchObject({ status: "graded", grade: "green", ruleSet: { code: "glucose_care_triage", version: 1 } });
  });

  it("a severe low is red with the page action, in shadow or not (the database decides shadow from the rule set status)", async () => {
    const { p, recorded } = ports({ loadGlucoseContext: async () => ({ found: true, input: glucoseInput(2.6) }) });
    await makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }), ctx);
    expect(recorded[0]?.result.grade).toBe("red");
    expect(recorded[0]?.result.actions).toContainEqual({ kind: "page_on_call" });
  });

  it("passes the basis the context reports", async () => {
    const { p, recorded } = ports({ loadGlucoseContext: async () => ({ found: true, basis: "abc", input: glucoseInput(6) }) });
    await makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }), ctx);
    expect(recorded[0]?.basis).toBe("abc");
  });

  it("does nothing for a reading that is gone or not glucose", async () => {
    const gone = ports({ loadGlucoseContext: async () => ({ found: false }) });
    await makeObservationHandler(gone.p)(event({ observation_id: "obs1", kind: "glucose" }), ctx);
    const noInput = ports({ loadGlucoseContext: async () => ({ found: true }) });
    await makeObservationHandler(noInput.p)(event({ observation_id: "obs1", kind: "glucose" }), ctx);
    expect(gone.recorded).toHaveLength(0);
    expect(noInput.recorded).toHaveLength(0);
    expect(gone.p.loadGlucoseRuleSet).not.toHaveBeenCalled();
  });

  it("no glucose rule set is a retryable failure, not a silent skip", async () => {
    const { p } = ports({ loadGlucoseRuleSet: async () => null });
    await expect(makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }), ctx)).rejects.toThrow("no glucose_care_triage rule set");
  });

  it("a malformed glucose rule set is refused, never half applied", async () => {
    const { p, recorded } = ports({ loadGlucoseRuleSet: async () => ({ ...draft, rules: { ...GLUCOSE_CARE_V1, rules: [] } }) });
    await expect(makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }), ctx)).rejects.toThrow("is not valid");
    expect(recorded).toHaveLength(0);
  });

  it("an implausible glucose is recorded as rejected, never graded", async () => {
    const { p, recorded } = ports({ loadGlucoseContext: async () => ({ found: true, input: glucoseInput(0.2) }) });
    await makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }), ctx);
    expect(recorded[0]?.result).toMatchObject({ status: "rejected", grade: null, explanationKey: "GLU-T06" });
  });

  it("an event without kind glucose still goes to the blood pressure path", async () => {
    const { p } = ports();
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(p.loadContext).toHaveBeenCalled();
    expect(p.loadGlucoseContext).not.toHaveBeenCalled();
  });
});

describe("the glucose database ports", () => {
  const rpcOk = (data: unknown) => ({ rpc: jest.fn(async () => ({ data, error: null })) }) as unknown as RpcClient & { rpc: jest.Mock };

  it("reads the glucose context", async () => {
    const client = rpcOk({ found: true, isTest: true, basis: "b", input: { n: 1 } });
    const out = await triagePorts(client).loadGlucoseContext("obs1");
    expect(client.rpc).toHaveBeenCalledWith("triage_context_for_glucose_observation", { p_observation_id: "obs1" });
    expect(out).toEqual({ found: true, isTest: true, basis: "b", input: { n: 1 } });
  });

  it("treats a missing context as not found and defaults the optional fields", async () => {
    expect(await triagePorts(rpcOk(null)).loadGlucoseContext("a")).toEqual({ found: false });
    expect(await triagePorts(rpcOk({ found: false })).loadGlucoseContext("a")).toEqual({ found: false });
    expect(await triagePorts(rpcOk({ found: true, input: {} })).loadGlucoseContext("a")).toMatchObject({ isTest: false, basis: "" });
  });

  it("reads the rule set for grading, or null", async () => {
    expect(await triagePorts(rpcOk({ id: "r", status: "draft", rules: { code: "x" } })).loadGlucoseRuleSet("glucose_care_triage")).toEqual({ id: "r", status: "draft", rules: { code: "x" } });
    expect(await triagePorts(rpcOk(null)).loadGlucoseRuleSet("glucose_care_triage")).toBeNull();
  });

  it("records a glucose result through its own function, not the blood pressure one", async () => {
    const client = rpcOk({});
    const result = { status: "rejected" } as unknown as TriageResult;
    await triagePorts(client).recordGlucose({ observationId: "obs1", result, ruleSetId: "rs1", causationId: "e1", basis: "b" });
    expect(client.rpc).toHaveBeenCalledWith("record_glucose_triage_result", { p_observation_id: "obs1", p_result: result, p_rule_set_id: "rs1", p_causation_id: "e1", p_basis: "b" });
  });
});
