import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

type Result = { data?: unknown; error?: { message: string } | null };
type Call = { table: string; filters: [string, ...unknown[]][] };

let results: Record<string, Result> = {};
let rpcResult: Result = { data: [] };
let calls: Call[] = [];
const captureException = jest.fn();

function chain(table: string) {
  const call: Call = { table, filters: [] };
  calls.push(call);
  const res = () => results[table] ?? { data: null, error: null };
  const proxy: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "lte", "gte", "lt", "gt", "in", "not", "order", "limit"]) {
    proxy[m] = (...args: unknown[]) => {
      if (m === "eq" || m === "is") call.filters.push([m, ...args]);
      return proxy;
    };
  }
  proxy.maybeSingle = () => Promise.resolve(res());
  proxy.then = (resolve: (v: Result) => unknown) => Promise.resolve(res()).then(resolve);
  return proxy;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => chain(t), rpc: () => Promise.resolve(rpcResult) }),
}));
jest.mock("@/lib/ai-coach/offered", () => ({ isAssistantOffered: async () => false }));
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

import { resolveNextAction } from "./next-best-action";

// 07:30 UTC is 08:30 in Lagos (UTC+1).
const NOW = Date.UTC(2026, 9, 22, 7, 30);
const MED = { id: "m1", drug_name: "Drug", schedule_times: ["08:00"], schedule_spec: null };
const RECENT_VITAL = { data: { id: "v1" } };

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  results = { vitals_readings: RECENT_VITAL, medications: { data: [] }, medication_logs_latest_per_slot: { data: [] } };
  rpcResult = { data: [] };
  calls = [];
  captureException.mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("resolveNextAction", () => {
  it("a dose slot that has passed on the Lagos clock (but not the UTC clock) is due", async () => {
    results.medications = { data: [MED] };
    expect((await resolveNextAction("p1")).kind).toBe("dose_due");
  });

  it("a slot later today is not due, and a logged slot is not due", async () => {
    results.medications = { data: [{ ...MED, schedule_times: ["20:00"] }] };
    expect((await resolveNextAction("p1")).kind).toBe("caught_up");
    results.medications = { data: [MED] };
    results.medication_logs_latest_per_slot = { data: [{ medication_id: "m1", scheduled_time: "08:00", status: "taken" }] };
    expect((await resolveNextAction("p1")).kind).toBe("caught_up");
  });

  it("an unanswered red alert wins over a due dose, a refill and a ready lesson", async () => {
    results.emergency_events = { data: { id: "e1" } };
    results.medications = { data: [MED] };
    rpcResult = { data: [{ code: "L1", completed_this_week: false, members_only: false }] };
    expect((await resolveNextAction("p1")).kind).toBe("red_alert");
  });

  it("a failed red-alert read is UNKNOWN: it gets the safety-check card, never the all-clear or a dose/lesson card, and is reported", async () => {
    results.emergency_events = { data: null, error: { message: "boom" } };
    results.medications = { data: [MED] };
    expect((await resolveNextAction("p1")).kind).toBe("safety_check");
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("any other failed read never shows caught_up and is reported", async () => {
    results.screening_schedules = { data: null, error: { message: "rls" } };
    expect((await resolveNextAction("p1")).kind).toBe("reading_due");
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("a lesson-RPC failure degrades to no lesson: not reported, not a data failure", async () => {
    rpcResult = { data: null, error: { message: "feature off" } };
    expect((await resolveNextAction("p1")).kind).toBe("caught_up");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("a ready lesson shows only when nothing else is waiting, and a members-only or completed lesson does not", async () => {
    rpcResult = { data: [{ code: "L1", completed_this_week: false, members_only: false }] };
    expect((await resolveNextAction("p1")).kind).toBe("lesson_ready");
    rpcResult = { data: [{ code: "L1", completed_this_week: true, members_only: false }] };
    expect((await resolveNextAction("p1")).kind).toBe("caught_up");
    rpcResult = { data: [{ code: "L1", completed_this_week: false, members_only: true }] };
    expect((await resolveNextAction("p1")).kind).toBe("caught_up");
  });

  it("the red-alert read uses the same filters as the site-wide EmergencyAlert query, and its link target exists", async () => {
    const action = await resolveNextAction("p1");
    expect(action.kind).toBe("caught_up");
    const call = calls.find((c) => c.table === "emergency_events");
    expect(call?.filters).toEqual([
      ["eq", "patient_id", "p1"],
      ["eq", "status", "active"],
      ["is", "acknowledged_at", null],
    ]);
    const hook = readFileSync(path.join(__dirname, "../../../lib/queries/emergency.ts"), "utf8");
    expect(hook).toContain('.eq("patient_id", patientId)');
    expect(hook).toContain('.eq("status", "active")');
    expect(hook).toContain('.is("acknowledged_at", null)');
    results.emergency_events = { data: { id: "e1" } };
    const red = await resolveNextAction("p1");
    expect(red.href).toBe("/patient#overview");
    const page = readFileSync(path.join(__dirname, "(sections)/page.tsx"), "utf8");
    expect(page).toContain('id="overview"');
  });
});
