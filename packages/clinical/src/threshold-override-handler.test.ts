import { describe, expect, it, jest } from "@jest/globals";
import { BP_CARE_V3, GLUCOSE_CARE_V1, type GlucoseInput } from "./index";
import {
  makeObservationHandler,
  OVERRIDE_LOAD_ATTEMPTS,
  TRIAGE_HANDLER_KEY,
  type RuleSetForGrading,
  type TriagePorts,
} from "../../../supabase/functions/_shared/triage/observation-handler";
import { triagePorts, type RpcClient } from "../../../supabase/functions/process-events/triage-ports";
import type { ActiveOverride } from "./threshold-override";
import type { BusEvent } from "../../../supabase/functions/_shared/event-bus/dispatch";
import type { TriageInput, TriageResult } from "./types";

/** The handler wiring of personal threshold overrides: loaded, applied after the signed grade, stored with provenance, never a reason to stop grading. */
const NOW = "2026-10-15T10:00:00.000Z";
const ctx = { once: async () => true };
const event = (payload: Record<string, unknown>, attempt = 1): BusEvent => ({
  deliveryId: "d1", leaseToken: "l1", attempt, eventId: "e1", eventType: "observation.recorded", eventVersion: 1,
  organisationId: "o1", patientId: "p1", aggregateType: "observation", aggregateId: "obs1", payload, priority: "normal",
  isTest: true, occurredAt: NOW, subscriberKey: TRIAGE_HANDLER_KEY, handlerKey: TRIAGE_HANDLER_KEY,
});
const hist = Array.from({ length: 6 }, (_, i) => ({ systolic: 160, diastolic: 95, takenAt: new Date(Date.parse(NOW) - (i + 1) * 86_400_000 + 1000).toISOString() }));
const bpInput: TriageInput = {
  trigger: { type: "observation", reading: { systolic: 150, diastolic: 92, takenAt: NOW }, symptoms: [], symptomsAnswered: true },
  history: hist, target: { systolic: 135, diastolic: 85 }, pathway: { state: "self_guided" }, pregnant: false, ageYears: 58, now: NOW,
};
const glInput: GlucoseInput = { trigger: { type: "glucose", reading: { mmol: 4.2, takenAt: NOW, context: "random" }, symptoms: [] }, diabetesType: "type_1", pregnant: false, ageYears: 40, now: NOW };
const bpOverride: ActiveOverride = { id: "o-bp", domain: "bp", params: { target: { systolic: 150, diastolic: 95 } }, signedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-11-30T00:00:00.000Z" };
const glOverride: ActiveOverride = { id: "o-gl", domain: "glucose", params: { hypoAlertMmol: 4.4 }, signedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-11-30T00:00:00.000Z" };
const bpSet: RuleSetForGrading = { id: "rs1", status: "approved", rules: BP_CARE_V3 };

function ports(over: Partial<TriagePorts> = {}) {
  const recorded: TriageResult[] = [];
  const applications: { domain: string; result: TriageResult }[] = [];
  const p: TriagePorts = {
    loadContext: async () => ({ found: true, input: bpInput }),
    loadRuleSet: async () => bpSet,
    record: async (a) => void recorded.push(a.result),
    loadGlucoseContext: async () => ({ found: true, input: glInput }),
    loadGlucoseRuleSet: async () => ({ id: "grs1", status: "approved", rules: GLUCOSE_CARE_V1 }),
    recordGlucose: async (a) => void recorded.push(a.result),
    loadThresholdOverride: async (_o, d) => (d === "bp" ? bpOverride : glOverride),
    recordOverrideApplication: async (a) => void applications.push({ domain: a.domain, result: a.result }),
    ...over,
  };
  return { p, recorded, applications };
}

describe("threshold overrides in the observation handler", () => {
  it("blood pressure: records the relaxed grade and then the provenance", async () => {
    const { p, recorded, applications } = ports();
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(recorded[0]?.grade).toBe("green");
    expect(recorded[0]?.override?.overrideId).toBe("o-bp");
    expect(applications).toHaveLength(1);
    expect(applications[0]?.domain).toBe("bp");
  });
  it("glucose: records the tightened grade and then the provenance", async () => {
    const { p, recorded, applications } = ports();
    await makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }), ctx);
    expect(recorded[0]?.grade).toBe("amber");
    expect(applications[0]?.domain).toBe("glucose");
  });
  it("no override: grades exactly as the signed rule set and stores no provenance", async () => {
    const { p, recorded, applications } = ports({ loadThresholdOverride: async () => null });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(recorded[0]?.grade).toBe("amber");
    expect(applications).toHaveLength(0);
  });
  it("ports without the override calls (an older wiring) grade as before", async () => {
    const { p, recorded } = ports({ loadThresholdOverride: undefined, recordOverrideApplication: undefined });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(recorded[0]?.grade).toBe("amber");
  });
  it("an override that changed the grade but a wiring that cannot store provenance still records the grade", async () => {
    const { p, recorded } = ports({ recordOverrideApplication: undefined });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(recorded[0]?.grade).toBe("green");
  });
  it("a failed override load is retried first (a lost override can be a silent downgrade), then graded at the default with a loud log", async () => {
    const load = jest.fn(async () => { throw new Error("rpc timed out"); });
    const { p, recorded, applications } = ports({ loadThresholdOverride: load });
    await expect(makeObservationHandler(p)(event({ observation_id: "obs1" }, 1), ctx)).rejects.toThrow("rpc timed out");
    await expect(makeObservationHandler(p)(event({ observation_id: "obs1", kind: "glucose" }, 2), ctx)).rejects.toThrow("rpc timed out");
    expect(recorded).toHaveLength(0);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await makeObservationHandler(p)(event({ observation_id: "obs1" }, OVERRIDE_LOAD_ATTEMPTS), ctx);
    expect(recorded[0]?.grade).toBe("amber");
    expect(applications).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("graded at the signed default"));
    log.mockRestore();
  });
  it("a database without the override functions yet grades as before, quietly", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { p, recorded } = ports({ loadThresholdOverride: async () => { throw new Error("triage_active_override_for_observation: Could not find the function public.triage_active_override_for_observation"); } });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
    expect(recorded[0]?.grade).toBe("amber");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("a fault inside the override layer never stops the signed grade being recorded (Error or not)", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    // the clamp check reads `target` once; the engine reads it again when it applies the override, and that read throws
    const faulty = (thrown: unknown): ActiveOverride => {
      let reads = 0;
      const params = { get target() { reads += 1; if (reads > 1) throw thrown; return { systolic: 150, diastolic: 95 }; } };
      return { id: "x", domain: "bp", params, signedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-11-30T00:00:00.000Z" } as ActiveOverride;
    };
    for (const thrown of [new Error("boom in the override layer"), "boom as plain text"]) {
      const { p, recorded } = ports({ loadThresholdOverride: async () => faulty(thrown) });
      await makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.grade).toBe("amber");
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("could not be applied"));
    log.mockRestore();
  });
  it("a non-error rejection is logged as text", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { p, recorded } = ports({ loadThresholdOverride: async () => Promise.reject("plain text failure") });
    await makeObservationHandler(p)(event({ observation_id: "obs1" }, OVERRIDE_LOAD_ATTEMPTS), ctx);
    expect(recorded).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("plain text failure"));
    log.mockRestore();
  });
  it("a failed provenance write is raised so the event retries (the grade write is idempotent)", async () => {
    const { p } = ports({ recordOverrideApplication: async () => { throw new Error("nope"); } });
    await expect(makeObservationHandler(p)(event({ observation_id: "obs1" }), ctx)).rejects.toThrow("nope");
  });
});

describe("triagePorts override calls", () => {
  const client = (data: unknown, error: { message: string } | null = null) => {
    const rpc = jest.fn(async (_n: string, _a: Record<string, unknown>) => ({ data, error }));
    return { c: { rpc } as unknown as RpcClient, rpc };
  };
  it("loads an override through the service-role function and maps null", async () => {
    const a = client(bpOverride);
    expect(await triagePorts(a.c).loadThresholdOverride?.("obs1", "bp")).toEqual(bpOverride);
    expect(a.rpc).toHaveBeenCalledWith("triage_active_override_for_observation", { p_observation_id: "obs1", p_domain: "bp" });
    expect(await triagePorts(client(null).c).loadThresholdOverride?.("obs1", "bp")).toBeNull();
  });
  it("records an application through the service-role function", async () => {
    const a = client({ ok: true });
    await triagePorts(a.c).recordOverrideApplication?.({ observationId: "obs1", domain: "glucose", result: { override: undefined } as unknown as TriageResult, ruleSetId: "rs1", basis: "b" });
    expect(a.rpc).toHaveBeenCalledWith("record_triage_override_application", expect.objectContaining({ p_observation_id: "obs1", p_domain: "glucose", p_rule_set_id: "rs1", p_basis: "b" }));
  });
});
