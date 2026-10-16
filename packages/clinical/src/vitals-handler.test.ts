import { describe, expect, it, jest } from "@jest/globals";
import { VITALS_CARE_V1, type VitalsInput } from "./index";
import {
  makeObservationHandler,
  TRIAGE_HANDLER_KEY,
  type TriagePorts,
  type VitalsRuleSetForGrading,
  type VitalsTriageContext,
} from "../../../supabase/functions/_shared/triage/observation-handler";
import { triagePorts, type RpcClient } from "../../../supabase/functions/process-events/triage-ports";
import type { BusEvent } from "../../../supabase/functions/_shared/event-bus/dispatch";
import type { TriageResult } from "./types";

/** The vitals half of the server triage handler, fed the JSON shape triage_context_for_vitals_observation returns. */
const NOW = "2026-10-16T10:00:00.000Z";
const vitalsInput = (type: VitalsInput["trigger"]["type"], value: number, over: Partial<VitalsInput> = {}): VitalsInput => ({
  trigger: { type, reading: { value, takenAt: NOW } },
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
const draft: VitalsRuleSetForGrading = { id: "vrs1", status: "draft", rules: VITALS_CARE_V1 };

function ports(over: Partial<TriagePorts> = {}) {
  const recorded: { observationId: string; result: TriageResult; ruleSetId: string; causationId: string; basis: string }[] = [];
  const p: TriagePorts = {
    loadContext: jest.fn(async () => ({ found: false })),
    loadRuleSet: jest.fn(async () => null),
    record: jest.fn(async () => undefined),
    loadGlucoseContext: jest.fn(async () => ({ found: false })),
    loadGlucoseRuleSet: jest.fn(async () => null),
    recordGlucose: jest.fn(async () => undefined),
    loadVitalsContext: jest.fn(async () => ({ found: true, input: vitalsInput("pulse", 72) }) as VitalsTriageContext),
    loadVitalsRuleSet: jest.fn(async () => draft),
    recordVitals: jest.fn(async (a: (typeof recorded)[number]) => void recorded.push(a)),
    ...over,
  };
  return { p, recorded };
}
const vitalsEvent = () => event({ observation_id: "obs1", kind: "vitals" });

describe("the vitals branch of the observation handler", () => {
  it("grades a vitals event with the vitals rule set and records it with the rule set and the event as cause, never touching the other ports", async () => {
    const { p, recorded } = ports();
    await makeObservationHandler(p)(vitalsEvent(), ctx);
    expect(p.loadVitalsRuleSet).toHaveBeenCalledWith("vitals_care_triage");
    expect(p.loadContext).not.toHaveBeenCalled();
    expect(p.loadGlucoseContext).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
    expect(p.recordGlucose).not.toHaveBeenCalled();
    expect(recorded[0]).toMatchObject({ observationId: "obs1", ruleSetId: "vrs1", causationId: "e1", basis: "" });
    expect(recorded[0]?.result).toMatchObject({ status: "graded", grade: "green", ruleSet: { code: "vitals_care_triage", version: 1 } });
  });

  it("a dangerous reading is red with the page action, in shadow or not (the database decides shadow from the rule set status)", async () => {
    for (const input of [vitalsInput("pulse", 30), vitalsInput("spo2", 85), vitalsInput("temperature", 41)]) {
      const { p, recorded } = ports({ loadVitalsContext: async () => ({ found: true, input }) });
      await makeObservationHandler(p)(vitalsEvent(), ctx);
      expect(recorded[0]?.result.grade).toBe("red");
      expect(recorded[0]?.result.actions).toContainEqual({ kind: "page_on_call" });
    }
  });

  it("a patient with no date of birth and no personal line (keys missing from the JSON, as jsonb_strip_nulls sends them) is graded, never rejected", async () => {
    const { ageYears: _a, ...stripped } = vitalsInput("pulse", 130);
    const { p, recorded } = ports({ loadVitalsContext: async () => ({ found: true, input: stripped as unknown as VitalsInput }) });
    await makeObservationHandler(p)(vitalsEvent(), ctx);
    expect(recorded[0]?.result).toMatchObject({ status: "graded", grade: "red", ruleId: "VT-PU2" });
  });

  it("keeps a personal amber line and an age that are present", async () => {
    const { p, recorded } = ports({ loadVitalsContext: async () => ({ found: true, input: vitalsInput("spo2", 96, { personalAmberLine: 96 }) }) });
    await makeObservationHandler(p)(vitalsEvent(), ctx);
    expect(recorded[0]?.result.ruleId).toBe("VT-OX4");
  });

  it("passes the basis the context reports", async () => {
    const { p, recorded } = ports({ loadVitalsContext: async () => ({ found: true, basis: "abc", input: vitalsInput("pulse", 72) }) });
    await makeObservationHandler(p)(vitalsEvent(), ctx);
    expect(recorded[0]?.basis).toBe("abc");
  });

  it("does nothing for a reading that is gone or has no input", async () => {
    const gone = ports({ loadVitalsContext: async () => ({ found: false }) });
    await makeObservationHandler(gone.p)(vitalsEvent(), ctx);
    const noInput = ports({ loadVitalsContext: async () => ({ found: true }) });
    await makeObservationHandler(noInput.p)(vitalsEvent(), ctx);
    expect(gone.recorded).toHaveLength(0);
    expect(noInput.recorded).toHaveLength(0);
    expect(gone.p.loadVitalsRuleSet).not.toHaveBeenCalled();
  });

  it("no vitals rule set is a retryable failure, not a silent skip", async () => {
    const { p } = ports({ loadVitalsRuleSet: async () => null });
    await expect(makeObservationHandler(p)(vitalsEvent(), ctx)).rejects.toThrow("no vitals_care_triage rule set");
  });

  it("a malformed vitals rule set is refused, never half applied", async () => {
    const { p, recorded } = ports({ loadVitalsRuleSet: async () => ({ ...draft, rules: { ...VITALS_CARE_V1, rules: [] } }) });
    await expect(makeObservationHandler(p)(vitalsEvent(), ctx)).rejects.toThrow("is not valid");
    expect(recorded).toHaveLength(0);
  });

  it("an implausible reading is recorded as rejected, never graded", async () => {
    const { p, recorded } = ports({ loadVitalsContext: async () => ({ found: true, input: vitalsInput("temperature", 3.6) }) });
    await makeObservationHandler(p)(vitalsEvent(), ctx);
    expect(recorded[0]?.result).toMatchObject({ status: "rejected", grade: null, explanationKey: "VIT-T04" });
  });

  it("an event without kind vitals still goes to the blood pressure path", async () => {
    const { p } = ports();
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(p.loadContext).toHaveBeenCalled();
    expect(p.loadVitalsContext).not.toHaveBeenCalled();
  });
});

describe("the vitals database ports", () => {
  const rpcOk = (data: unknown) => ({ rpc: jest.fn(async () => ({ data, error: null })) }) as unknown as RpcClient & { rpc: jest.Mock };

  it("reads the vitals context", async () => {
    const client = rpcOk({ found: true, isTest: true, basis: "b", input: { n: 1 } });
    const out = await triagePorts(client).loadVitalsContext("obs1");
    expect(client.rpc).toHaveBeenCalledWith("triage_context_for_vitals_observation", { p_observation_id: "obs1" });
    expect(out).toEqual({ found: true, isTest: true, basis: "b", input: { n: 1 } });
  });

  it("treats a missing context as not found and defaults the optional fields", async () => {
    expect(await triagePorts(rpcOk(null)).loadVitalsContext("a")).toEqual({ found: false });
    expect(await triagePorts(rpcOk({ found: false })).loadVitalsContext("a")).toEqual({ found: false });
    expect(await triagePorts(rpcOk({ found: true, input: {} })).loadVitalsContext("a")).toMatchObject({ isTest: false, basis: "" });
  });

  it("reads the rule set for grading, or null", async () => {
    expect(await triagePorts(rpcOk({ id: "r", status: "draft", rules: { code: "x" } })).loadVitalsRuleSet("vitals_care_triage")).toEqual({ id: "r", status: "draft", rules: { code: "x" } });
    expect(await triagePorts(rpcOk(null)).loadVitalsRuleSet("vitals_care_triage")).toBeNull();
  });

  it("records a vitals result through its own function, not the blood pressure or glucose one", async () => {
    const client = rpcOk({});
    const result = { status: "rejected" } as unknown as TriageResult;
    await triagePorts(client).recordVitals({ observationId: "obs1", result, ruleSetId: "rs1", causationId: "e1", basis: "b" });
    expect(client.rpc).toHaveBeenCalledWith("record_vitals_triage_result", { p_observation_id: "obs1", p_result: result, p_rule_set_id: "rs1", p_causation_id: "e1", p_basis: "b" });
  });
});
