import { describe, expect, it, jest } from "@jest/globals";
import { BP_CARE_V3 } from "./index";
import {
  COVERAGE_HANDLER_KEY,
  makeCoverageHandler,
  type CoverageContext,
  type CoveragePorts,
} from "../../../supabase/functions/_shared/triage/coverage-handler";
import type { RuleSetForGrading } from "../../../supabase/functions/_shared/triage/observation-handler";
import { coveragePorts, type RpcClient } from "../../../supabase/functions/process-events/triage-ports";
import { PermanentHandlerError, type BusEvent } from "../../../supabase/functions/_shared/event-bus/dispatch";
import type { TriageInput, TriageResult } from "./types";

/**
 * P6: silence (BP-A5) and adherence (BP-A4) reach the SAME engine the phone runs, under the approved rule set (v3, a 7 day
 * silence line). These tests feed the handler the JSON shape triage_context_for_coverage returns.
 */
const NOW = "2026-10-20T06:52:00.000Z";
const approved: RuleSetForGrading = { id: "rs3", status: "approved", rules: BP_CARE_V3 };

function input(trigger: TriageInput["trigger"], over: Partial<TriageInput> = {}): TriageInput {
  return { trigger, history: [], target: { systolic: 135, diastolic: 85 }, pathway: { state: "care_pack_active" }, pregnant: false, ageYears: 50, now: NOW, existingOpenTaskKeys: [], ...over };
}

function event(eventType: string, payload: Record<string, unknown> = { day: "2026-10-20" }, patientId: string | null = "p1"): BusEvent {
  return {
    deliveryId: "d1", leaseToken: "l1", attempt: 1, eventId: "e1", eventType, eventVersion: 1, organisationId: "o1", patientId,
    aggregateType: "patient", aggregateId: patientId, payload, priority: "normal", isTest: true, occurredAt: NOW,
    subscriberKey: "triage.grade_silence", handlerKey: COVERAGE_HANDLER_KEY,
  };
}
const ctx = { once: async () => true };

function ports(context: CoverageContext, over: Partial<CoveragePorts> = {}) {
  const recorded: Parameters<CoveragePorts["record"]>[0][] = [];
  const p: CoveragePorts = {
    loadContext: jest.fn(async () => context),
    loadRuleSet: jest.fn(async () => approved),
    record: jest.fn(async (a: Parameters<CoveragePorts["record"]>[0]) => void recorded.push(a)),
    ...over,
  };
  return { p, recorded };
}

describe("the coverage handler", () => {
  it("SAFETY CASE 7: eight days of silence under v3 is an amber silence_check task, anchored on the last reading date, with the trigger kept as context", async () => {
    const trigger = { type: "silence" as const, lastReadingAt: "2026-10-12T09:00:00.000Z", sinceAt: "2026-09-01T00:00:00.000Z" };
    const { p, recorded } = ports({ found: true, input: input(trigger) });
    await makeCoverageHandler(p)(event("silence.detected"), ctx);
    expect(p.loadContext).toHaveBeenCalledWith("p1", "silence", "2026-10-20");
    const r = recorded[0]?.result as TriageResult;
    expect(r).toMatchObject({ status: "graded", grade: "amber", ruleId: "BP-A5", taskKey: "BP-A5:2026-10-12" });
    expect(r.actions).toContainEqual(expect.objectContaining({ kind: "create_task", task: "silence_check", dueMinutes: 2880 }));
    expect(recorded[0]).toMatchObject({ patientId: "p1", trigger: "silence", day: "2026-10-20", ruleSetId: "rs3", causationId: "e1", context: trigger });
  });

  it("v3 draws the line at seven days: six days of silence creates nothing, seven does", async () => {
    const at = (days: number) => ({ type: "silence" as const, lastReadingAt: new Date(Date.parse(NOW) - days * 86_400_000).toISOString(), sinceAt: "2026-09-01T00:00:00.000Z" });
    const six = ports({ found: true, input: input(at(6)) });
    await makeCoverageHandler(six.p)(event("silence.detected"), ctx);
    expect((six.recorded[0]?.result.actions ?? []).some((a) => a.kind === "create_task")).toBe(false);
    const seven = ports({ found: true, input: input(at(7)) });
    await makeCoverageHandler(seven.p)(event("silence.detected"), ctx);
    expect(seven.recorded[0]?.result.ruleId).toBe("BP-A5");
  });

  it("a Member who never read is counted from when the programme began", async () => {
    const { p, recorded } = ports({ found: true, input: input({ type: "silence", lastReadingAt: null, sinceAt: "2026-10-01T00:00:00.000Z" }) });
    await makeCoverageHandler(p)(event("silence.detected"), ctx);
    expect(recorded[0]?.result.taskKey).toBe("BP-A5:2026-10-01");
  });

  it("a task key already open is not asked for again (the engine drops the task, the grade is still recorded)", async () => {
    const trigger = { type: "silence" as const, lastReadingAt: "2026-10-12T09:00:00.000Z", sinceAt: "2026-09-01T00:00:00.000Z" };
    const { p, recorded } = ports({ found: true, input: input(trigger, { existingOpenTaskKeys: ["BP-A5:2026-10-12"] }) });
    await makeCoverageHandler(p)(event("silence.detected"), ctx);
    expect(recorded[0]?.result).toMatchObject({ duplicateSuppressed: true, taskKey: "BP-A5:2026-10-12" });
    expect(recorded[0]?.result.actions.some((a) => a.kind === "create_task")).toBe(false);
  });

  it("adherence under the line is an amber adherence_review task keyed on the ISO week; at the line it is nothing", async () => {
    const low = ports({ found: true, input: input({ type: "adherence", percent7d: 62 }) });
    await makeCoverageHandler(low.p)(event("adherence.below_line"), ctx);
    expect(low.p.loadContext).toHaveBeenCalledWith("p1", "adherence", "2026-10-20");
    expect(low.recorded[0]?.result).toMatchObject({ grade: "amber", ruleId: "BP-A4", taskKey: "BP-A4:2026-W43" });
    expect(low.recorded[0]?.result.actions).toContainEqual(expect.objectContaining({ kind: "create_task", task: "adherence_review" }));
    const ok = ports({ found: true, input: input({ type: "adherence", percent7d: 80 }) });
    await makeCoverageHandler(ok.p)(event("adherence.below_line"), ctx);
    expect((ok.recorded[0]?.result.actions ?? []).some((a) => a.kind === "create_task")).toBe(false);
  });

  it("a patient who is not on a care pack (a Free patient) never gets a task even if an event slipped through", async () => {
    const trigger = { type: "silence" as const, lastReadingAt: "2026-10-01T09:00:00.000Z", sinceAt: "2026-09-01T00:00:00.000Z" };
    const { recorded, p } = ports({ found: true, input: input(trigger, { pathway: { state: "self_guided" } }) });
    await makeCoverageHandler(p)(event("silence.detected"), ctx);
    expect(recorded[0]?.result.actions.some((a) => a.kind === "create_task")).toBe(false);
  });

  it("a Member with no date of birth (ageYears missing from the JSON) is still graded, not rejected", async () => {
    const trigger = { type: "silence" as const, lastReadingAt: "2026-10-12T09:00:00.000Z", sinceAt: "2026-09-01T00:00:00.000Z" };
    const { ageYears: _dropped, ...noAge } = input(trigger);
    const { p, recorded } = ports({ found: true, input: noAge as unknown as TriageInput });
    await makeCoverageHandler(p)(event("silence.detected"), ctx);
    expect(recorded[0]?.result).toMatchObject({ status: "graded", ruleId: "BP-A5" });
  });

  it("no context (lapsed, or no doses due) grades and records nothing, and does not even load the rule set", async () => {
    const { p, recorded } = ports({ found: false });
    await makeCoverageHandler(p)(event("silence.detected"), ctx);
    expect(recorded).toHaveLength(0);
    expect(p.loadRuleSet).not.toHaveBeenCalled();
  });

  it("an input the engine rejects is not recorded; an invalid rule set throws so the delivery retries and dead-letters visibly", async () => {
    const bad = ports({ found: true, input: input({ type: "adherence", percent7d: 500 }) });
    await makeCoverageHandler(bad.p)(event("adherence.below_line"), ctx);
    expect(bad.recorded).toHaveLength(0);
    const broken = ports({ found: true, input: input({ type: "adherence", percent7d: 10 }) }, { loadRuleSet: async () => ({ ...approved, rules: { ...BP_CARE_V3, params: undefined } as never }) });
    await expect(makeCoverageHandler(broken.p)(event("adherence.below_line"), ctx)).rejects.toThrow(/not valid/);
    const none = ports({ found: true, input: input({ type: "adherence", percent7d: 10 }) }, { loadRuleSet: async () => null });
    await expect(makeCoverageHandler(none.p)(event("adherence.below_line"), ctx)).rejects.toThrow(/no bp_care_triage/);
  });

  it("refuses what it cannot act on, permanently: another event type, no patient, no day", async () => {
    const { p } = ports({ found: false });
    const h = makeCoverageHandler(p);
    await expect(h(event("dose.missed"), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    await expect(h(event("silence.detected", { day: "2026-10-20" }, null), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    await expect(h(event("silence.detected", {}), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    await expect(h(event("silence.detected", { day: "yesterday" }), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
  });
});

describe("the coverage database ports", () => {
  function client(responses: Record<string, unknown>) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const c: RpcClient = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: responses[name] ?? null, error: null };
      },
    };
    return { c, calls };
  }

  it("asks for the context, the rule set and records with the names the migration defines", async () => {
    const { c, calls } = client({
      triage_context_for_coverage: { found: true, input: { trigger: { type: "adherence", percent7d: 10 } } },
      triage_rule_set_for_grading: { id: "rs3", status: "approved", rules: BP_CARE_V3 },
    });
    const ports = coveragePorts(c);
    expect((await ports.loadContext("p1", "adherence", "2026-10-20")).found).toBe(true);
    expect((await ports.loadRuleSet("bp_care_triage"))?.id).toBe("rs3");
    await ports.record({ patientId: "p1", trigger: "adherence", day: "2026-10-20", result: { status: "graded" } as TriageResult, ruleSetId: "rs3", causationId: "e1", context: { type: "adherence" } });
    expect(calls.map((x) => x.name)).toEqual(["triage_context_for_coverage", "triage_rule_set_for_grading", "record_coverage_triage_result"]);
    expect(calls[0]?.args).toEqual({ p_patient: "p1", p_trigger: "adherence", p_day: "2026-10-20" });
    expect(Object.keys(calls[2]?.args ?? {}).sort()).toEqual(["p_causation_id", "p_context", "p_day", "p_patient", "p_result", "p_rule_set_id", "p_trigger"]);
  });

  it("a not-found context and a missing rule set map to found:false and null; an rpc error throws with the function name", async () => {
    expect(await coveragePorts(client({ triage_context_for_coverage: { found: false } }).c).loadContext("p1", "silence", "2026-10-20")).toEqual({ found: false });
    expect(await coveragePorts(client({}).c).loadRuleSet("bp_care_triage")).toBeNull();
    const failing: RpcClient = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(coveragePorts(failing).loadContext("p1", "silence", "2026-10-20")).rejects.toThrow("triage_context_for_coverage: boom");
  });
});
