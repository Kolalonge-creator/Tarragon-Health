import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ingestReadings, lagosDateOf } from "./ingest";
import type { NormalisedReading } from "./normalise";

/**
 * Steps synced from a phone used to land in wearable_readings and stop there,
 * while the patient's step meter read activity_log_entries — two tables with
 * nothing between them, so a patient could walk 10,000 steps and be shown 0.
 * These cover the bridge, and specifically the parts whose failure mode is a
 * silently wrong number rather than an error.
 */

function steps(value: number, recordedAt: string, id = `steps:${recordedAt}`): NormalisedReading {
  return { readingType: "steps", value, unit: "steps", recordedAt, externalReadingId: id };
}

/** Minimal fake: records rpc calls, swallows inserts. */
function fakeSvc(rpcResult: unknown = true) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const svc = {
    from: () => ({ insert: async () => ({ error: null }) }),
    rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: rpcResult, error: null };
    }),
  };
  return { svc: svc as unknown as SupabaseClient<Database>, rpcCalls };
}

const target = { connectionId: "c1", organisationId: "o1", patientId: "p1" };

describe("lagosDateOf", () => {
  it("uses Africa/Lagos, matching how the reader decides 'today'", () => {
    // 23:30 UTC is already the next day in Lagos (UTC+1). Getting this wrong
    // puts a patient's evening walk on the wrong day.
    expect(lagosDateOf("2026-08-11T23:30:00.000Z")).toBe("2026-08-12");
    expect(lagosDateOf("2026-08-12T00:30:00.000Z")).toBe("2026-08-12");
  });

  it("returns null for an unparseable timestamp instead of a bogus day", () => {
    expect(lagosDateOf("not-a-date")).toBeNull();
  });
});

describe("step totals reaching the patient-facing activity log", () => {
  it("records a day's total via the service-role RPC", async () => {
    const { svc, rpcCalls } = fakeSvc(true);
    const result = await ingestReadings(svc, target, [steps(9412, "2026-08-12T18:00:00.000Z")]);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("record_wearable_step_count");
    expect(rpcCalls[0].args).toMatchObject({
      p_patient_id: "p1",
      p_organisation_id: "o1",
      p_logged_on: "2026-08-12",
      p_step_count: 9412,
    });
    expect(result.stepDaysRecorded).toBe(1);
    expect(result.stepDaysDeferredToManual).toBe(0);
  });

  it("keeps the largest total when one day arrives more than once", async () => {
    // A day's step count only grows. Two providers, or an overlapping pull
    // window, can both report the same day; the smaller number is a staler
    // read, not a correction.
    const { svc, rpcCalls } = fakeSvc(true);
    await ingestReadings(svc, target, [
      steps(3000, "2026-08-12T09:00:00.000Z", "a"),
      steps(9412, "2026-08-12T18:00:00.000Z", "b"),
      steps(7000, "2026-08-12T14:00:00.000Z", "c"),
    ]);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_step_count).toBe(9412);
  });

  it("writes one RPC call per distinct day", async () => {
    const { svc, rpcCalls } = fakeSvc(true);
    await ingestReadings(svc, target, [
      steps(4000, "2026-08-11T12:00:00.000Z", "a"),
      steps(9412, "2026-08-12T12:00:00.000Z", "b"),
    ]);

    expect(rpcCalls.map((c) => c.args.p_logged_on)).toEqual(["2026-08-11", "2026-08-12"]);
  });

  it("counts a day the RPC declined as deferred, not as recorded", async () => {
    // The function returns null when the patient typed their own count for
    // that day; a sync never overwrites a person's own entry.
    const { svc } = fakeSvc(null);
    const result = await ingestReadings(svc, target, [steps(9412, "2026-08-12T18:00:00.000Z")]);

    expect(result.stepDaysRecorded).toBe(0);
    expect(result.stepDaysDeferredToManual).toBe(1);
  });

  it("does not touch the activity log for non-step metrics", async () => {
    const { svc, rpcCalls } = fakeSvc(true);
    await ingestReadings(svc, target, [
      { readingType: "hrv_ms", value: 42, unit: "ms", recordedAt: "2026-08-12T12:00:00.000Z", externalReadingId: "h1" },
      { readingType: "weight", value: 82.5, unit: "kg", recordedAt: "2026-08-12T12:00:00.000Z", externalReadingId: "w1" },
    ]);

    expect(rpcCalls).toHaveLength(0);
  });

  it("skips a step sample whose timestamp cannot be parsed", async () => {
    const { svc, rpcCalls } = fakeSvc(true);
    const result = await ingestReadings(svc, target, [steps(9412, "nonsense")]);

    expect(rpcCalls).toHaveLength(0);
    expect(result.stepDaysRecorded).toBe(0);
  });
});

describe("consent gating (53.3/53.4)", () => {
  it("drops a reading whose category the patient denied, never reaching the activity log", async () => {
    const { svc, rpcCalls } = fakeSvc(true);
    const denied = {
      ...target,
      consent: { activity: false, heart_rate: true, sleep: true, weight: true },
    };
    const result = await ingestReadings(svc, denied, [steps(9412, "2026-08-12T18:00:00.000Z")]);

    expect(rpcCalls).toHaveLength(0);
    expect(result.stepDaysRecorded).toBe(0);
    expect(result.deniedByConsent).toBe(1);
    expect(result.implausible).toBe(0);
  });

  it("still syncs every other consented category on the same connection", async () => {
    const { svc, rpcCalls } = fakeSvc(true);
    const activityOnlyDenied = {
      ...target,
      consent: { activity: false, heart_rate: true, sleep: true, weight: true },
    };
    const result = await ingestReadings(svc, activityOnlyDenied, [
      steps(9412, "2026-08-12T18:00:00.000Z"),
      { readingType: "hrv_ms", value: 42, unit: "ms", recordedAt: "2026-08-12T12:00:00.000Z", externalReadingId: "h1" },
    ]);

    expect(rpcCalls).toHaveLength(0); // the steps reading was denied
    expect(result.deniedByConsent).toBe(1);
    expect(result.wearableInserted).toBe(1); // hrv_ms still went through
  });

  it("defaults to full consent when the caller passes none (the mobile HealthKit/Health Connect bridge)", async () => {
    const { svc, rpcCalls } = fakeSvc(true);
    const result = await ingestReadings(svc, target, [steps(9412, "2026-08-12T18:00:00.000Z")]);

    expect(rpcCalls).toHaveLength(1);
    expect(result.deniedByConsent).toBe(0);
  });
});
