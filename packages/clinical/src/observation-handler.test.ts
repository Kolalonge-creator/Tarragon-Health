import { describe, expect, it, jest } from "@jest/globals";
import { BP_CARE_V1 } from "./index";
import {
  BP_RULE_SET_CODE,
  makeObservationHandler,
  TRIAGE_HANDLER_KEY,
  type RuleSetForGrading,
  type TriageContext,
  type TriagePorts,
} from "../../../supabase/functions/_shared/triage/observation-handler";
import { triagePorts, type RpcClient } from "../../../supabase/functions/process-events/triage-ports";
import { PermanentHandlerError, type BusEvent } from "../../../supabase/functions/_shared/event-bus/dispatch";
import type { TriageInput, TriageResult } from "./types";

/**
 * S12: the server half of triage. The handler runs the same engine as the phone, so these tests feed it the
 * exact JSON shape triage_context_for_observation returns and check what record_triage_result is asked to store.
 */
const NOW = "2026-10-05T10:00:00.000Z";

function input(over: Partial<TriageInput> & { trigger: TriageInput["trigger"] }): TriageInput {
  return { history: [], target: { systolic: 135, diastolic: 85 }, pathway: { state: "self_guided" }, pregnant: false, ageYears: 50, now: NOW, existingOpenTaskKeys: [], ...over };
}
const reading = (systolic: number, diastolic: number, takenAt = NOW) => ({ systolic, diastolic, takenAt });

function event(payload: Record<string, unknown>): BusEvent {
  return {
    deliveryId: "d1", leaseToken: "l1", attempt: 1, eventId: "e1", eventType: "observation.recorded", eventVersion: 1,
    organisationId: "o1", patientId: "p1", aggregateType: "observation", aggregateId: "obs1", payload, priority: "normal",
    isTest: true, occurredAt: NOW, subscriberKey: TRIAGE_HANDLER_KEY, handlerKey: TRIAGE_HANDLER_KEY,
  };
}
const ctx = { once: async () => true };
const draft: RuleSetForGrading = { id: "rs1", status: "draft", rules: BP_CARE_V1 };

function ports(over: Partial<TriagePorts> = {}) {
  const recorded: { observationId: string; result: TriageResult; ruleSetId: string; causationId: string }[] = [];
  const p: TriagePorts = {
    loadContext: jest.fn(async () => ({ found: true, input: input({ trigger: { type: "observation", reading: reading(124, 78), symptoms: [] } }) }) as TriageContext),
    loadRuleSet: jest.fn(async () => draft),
    record: jest.fn(async (a: (typeof recorded)[number]) => void recorded.push(a)),
    ...over,
  };
  return { p, recorded };
}

describe("the observation handler", () => {
  it("grades a reading within target green and records it with the rule set it used and the event as cause", async () => {
    const { p, recorded } = ports();
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(p.loadRuleSet).toHaveBeenCalledWith(BP_RULE_SET_CODE);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.result.grade).toBe("green");
    expect(recorded[0]).toMatchObject({ observationId: "obs1", ruleSetId: "rs1", causationId: "e1", basis: "" });
  });

  it("safety case 1 on the server: 185/125 with severe headache is red and asks to page on-call", async () => {
    const { p, recorded } = ports({
      loadContext: async () => ({ found: true, input: input({ trigger: { type: "observation", reading: reading(185, 125), symptoms: ["severe_headache"] } }) }),
    });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    const r = recorded[0]?.result;
    expect(r?.grade).toBe("red");
    expect(r?.actions).toContainEqual({ kind: "page_on_call" });
  });

  it("safety case 3: a first 182/112 asks for a repeat, then a repeat 181/111 is amber with a 4 hour task", async () => {
    const first = ports({
      loadContext: async () => ({ found: true, input: input({ trigger: { type: "observation", reading: reading(182, 112), symptoms: [] } }) }),
    });
    await makeObservationHandler(first.p)(event({ observation_id: "obs1" }), ctx);
    expect(first.recorded[0]?.result.status).toBe("recheck_required");

    const second = ports({
      loadContext: async () => ({
        found: true,
        input: input({
          trigger: {
            type: "observation",
            reading: reading(181, 111),
            symptoms: [],
            recheck: { kind: "repeat", previous: reading(182, 112, "2026-10-05T09:55:00.000Z"), minutesSincePrevious: 5 },
          },
        }),
      }),
    });
    await makeObservationHandler(second.p)(event({ observation_id: "obs2" }), ctx);
    const r = second.recorded[0]?.result;
    expect(r?.grade).toBe("amber");
    expect(r?.actions).toContainEqual(expect.objectContaining({ kind: "create_task", dueMinutes: 240 }));
  });

  it("accepts the timestamp format Postgres puts in the context (microseconds, +00:00 offset)", async () => {
    const pg = "2026-10-05T10:00:00.123456+00:00";
    const { p, recorded } = ports({
      loadContext: async () => ({ found: true, input: input({ now: pg, trigger: { type: "observation", reading: reading(150, 95, pg), symptoms: [] }, history: [reading(148, 94, "2026-10-04T08:00:00.5+00:00")] }) }),
    });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(recorded[0]?.result.status).toBe("graded");
  });

  it("a timed_out event is passed to the context and grades the first reading as if repeated", async () => {
    const loadContext = jest.fn(async (_id: string, recheck: "timed_out" | null) => ({
      found: true,
      input: input({ trigger: { type: "observation", reading: reading(182, 112), symptoms: [], ...(recheck ? { recheck: { kind: "timed_out" as const } } : {}) } }),
    }));
    const { p, recorded } = ports({ loadContext });
    await makeObservationHandler(p)(event({ observation_id: "obs1", recheck: "timed_out" }), ctx);
    expect(loadContext).toHaveBeenCalledWith("obs1", "timed_out");
    expect(recorded[0]?.result.grade).toBe("amber");
  });

  it("safety case 5: an implausible reading is recorded as rejected, never graded", async () => {
    const { p, recorded } = ports({
      loadContext: async () => ({ found: true, input: input({ trigger: { type: "observation", reading: reading(300, 40), symptoms: [] } }) }),
    });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(recorded[0]?.result).toMatchObject({ status: "rejected", grade: null, explanationKey: "TRI-006" });
  });

  it("does nothing for a reading that is gone or is not blood pressure", async () => {
    const { p, recorded } = ports({ loadContext: async () => ({ found: false }) });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    const noInput = ports({ loadContext: async () => ({ found: true }) });
    await makeObservationHandler(noInput.p)(event({ observation_id: "obs1" }), ctx);
    expect(recorded).toHaveLength(0);
    expect(noInput.recorded).toHaveLength(0);
    expect(p.loadRuleSet).not.toHaveBeenCalled();
  });

  it("a payload with no observation id goes straight to the dead letter", async () => {
    await expect(makeObservationHandler(ports().p)(event({}), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    await expect(makeObservationHandler(ports().p)(event({ observation_id: "" }), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
  });

  it("no rule set to grade with is a retryable failure, not a silent skip", async () => {
    const { p } = ports({ loadRuleSet: async () => null });
    await expect(makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx)).rejects.toThrow("no bp_care_triage rule set");
  });

  it("a malformed rule set is refused, never half applied", async () => {
    const { p, recorded } = ports({ loadRuleSet: async () => ({ ...draft, rules: { ...BP_CARE_V1, rules: [] } }) });
    await expect(makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx)).rejects.toThrow("is not valid");
    expect(recorded).toHaveLength(0);
  });

  it("a failed save is thrown so the bus retries it", async () => {
    const { p } = ports({ record: async () => { throw new Error("db down"); } });
    await expect(makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx)).rejects.toThrow("db down");
  });
});

describe("the database ports", () => {
  const rpcOk = (data: unknown) => ({ rpc: jest.fn(async () => ({ data, error: null })) }) as unknown as RpcClient & { rpc: jest.Mock };

  it("reads the context, passing the recheck state", async () => {
    const client = rpcOk({ found: true, isTest: true, input: { n: 1 } });
    const out = await triagePorts(client).loadContext("obs1", "timed_out");
    expect(client.rpc).toHaveBeenCalledWith("triage_context_for_observation", { p_observation_id: "obs1", p_recheck: "timed_out" });
    expect(out).toEqual({ found: true, isTest: true, basis: "", input: { n: 1 } });
  });

  it("treats a missing or not found context as not found", async () => {
    expect(await triagePorts(rpcOk(null)).loadContext("a", null)).toEqual({ found: false });
    expect(await triagePorts(rpcOk({ found: false })).loadContext("a", null)).toEqual({ found: false });
    expect(await triagePorts(rpcOk({ found: true, input: {} })).loadContext("a", null)).toMatchObject({ isTest: false, basis: "" });
    expect(await triagePorts(rpcOk({ found: true, basis: "abc", input: {} })).loadContext("a", null)).toMatchObject({ basis: "abc" });
  });

  it("reads the rule set for grading, or null", async () => {
    const set = await triagePorts(rpcOk({ id: "rs1", status: "approved", rules: { code: "x" } })).loadRuleSet("bp_care_triage");
    expect(set).toEqual({ id: "rs1", status: "approved", rules: { code: "x" } });
    expect(await triagePorts(rpcOk(null)).loadRuleSet("bp_care_triage")).toBeNull();
  });

  it("records a result with the rule set and the cause", async () => {
    const client = rpcOk({});
    const result = { status: "rejected" } as unknown as TriageResult;
    await triagePorts(client).record({ observationId: "obs1", result, ruleSetId: "rs1", causationId: "e1", basis: "b" });
    expect(client.rpc).toHaveBeenCalledWith("record_triage_result", { p_observation_id: "obs1", p_result: result, p_rule_set_id: "rs1", p_causation_id: "e1", p_basis: "b" });
  });

  it("turns a database error into a thrown error naming the function", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as unknown as RpcClient;
    await expect(triagePorts(client).loadRuleSet("x")).rejects.toThrow("triage_rule_set_for_grading: boom");
  });
});
