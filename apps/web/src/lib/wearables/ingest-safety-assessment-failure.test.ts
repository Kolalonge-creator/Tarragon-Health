import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { NormalisedReading } from "./normalise";

/**
 * assessBpControlBestEffort/assessHeartRateBestEffort are documented "never
 * throws," but that isn't literally enforced by a try/catch inside either of
 * them — see the offline-resilience audit's §7.1 follow-up
 * (docs/OFFLINE_RESILIENCE_AUDIT.md, added on the separate, unmerged
 * fix/offline-low-bandwidth-resilience branch — not present here). Before this
 * fix, a genuine network/DB drop right after a wearable batch's own insert
 * succeeded would throw straight out of ingestReadings uncaught. Because
 * ingestInto/ingestFor (sync.ts) only catch WearableIngestError, that throw
 * would propagate all the way out to the webhook route's per-connection loop
 * or the cron sweep's per-connection loop, aborting every OTHER connection in
 * that batch/run — not just the one whose assessment failed.
 *
 * These are the regression tests: ingestReadings must swallow a failure in
 * either assessor, keep processing, and report it via
 * IngestResult.safetyAssessmentFailed rather than silently reporting a clean
 * sync over a batch whose abnormal-result detection didn't actually run.
 */

const captureException = jest.fn<(...args: unknown[]) => void>();
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const assessBpControlBestEffort = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@/lib/ml/assess-bp-control", () => ({
  assessBpControlBestEffort: (...args: unknown[]) => assessBpControlBestEffort(...args),
}));

const assessHeartRateBestEffort = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@/lib/vitals/assess-heart-rate", () => ({
  assessHeartRateBestEffort: (...args: unknown[]) => assessHeartRateBestEffort(...args),
}));

import { ingestReadings, WearableIngestError } from "./ingest";

type InsertedRow = Record<string, unknown>;

interface FakeOptions {
  /** Rows whose external_reading_id matches fail insert with this error,
   * simulating a genuine (non-duplicate) storage failure alongside whatever
   * assessor rejection the test also configures. */
  failOn?: { ids: string[]; code: string; message: string };
}

function fakeSvc(options: FakeOptions = {}) {
  const inserted: Record<string, InsertedRow[]> = { vitals_readings: [], wearable_readings: [] };
  const emptyQuery = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      then: (resolve: (value: { data: never[]; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    };
    return builder;
  };
  const svc = {
    from: (table: string) => ({
      insert: async (rows: InsertedRow[]) => {
        const badRow = rows.find((row) => options.failOn?.ids.includes(String(row.external_reading_id ?? "")));
        if (badRow) return { error: { code: options.failOn!.code, message: options.failOn!.message } };
        inserted[table]?.push(...rows);
        return { error: null };
      },
      select: (...args: unknown[]) => emptyQuery().select(...(args as [])),
    }),
    rpc: async () => ({ data: true, error: null }),
  };
  return { svc: svc as unknown as SupabaseClient<Database>, inserted };
}

const target = { connectionId: "c1", organisationId: "o1", patientId: "p1" };

function bp(id = "bp1"): NormalisedReading {
  return {
    readingType: "blood_pressure",
    value: 120,
    unit: "mmHg",
    recordedAt: "2026-09-24T08:00:00.000Z",
    externalReadingId: id,
    secondaryValue: 80,
  };
}

function pulse(id = "hr1"): NormalisedReading {
  return {
    readingType: "resting_heart_rate",
    value: 72,
    unit: "bpm",
    recordedAt: "2026-09-24T08:00:00.000Z",
    externalReadingId: id,
  };
}

describe("ingestReadings — safety-assessment failure isolation", () => {
  beforeEach(() => {
    captureException.mockReset();
    assessBpControlBestEffort.mockReset().mockResolvedValue(undefined);
    assessHeartRateBestEffort.mockReset().mockResolvedValue(undefined);
  });

  it("does not throw when assessBpControlBestEffort rejects, and reports safetyAssessmentFailed", async () => {
    // Sabotage check: without the try/catch this fix adds, this rejection
    // would propagate straight out of ingestReadings, which is exactly what
    // used to abort every other connection in the same webhook batch/cron
    // sweep.
    assessBpControlBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const result = await ingestReadings(fakeSvc().svc, target, [bp()]);

    expect(result.vitalsInserted).toBe(1);
    expect(result.safetyAssessmentFailed).toBe(true);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        extra: expect.objectContaining({ stage: "safety_assessment", assessor: "bp_control" }),
      })
    );
  });

  it("does not throw when assessHeartRateBestEffort rejects, and reports safetyAssessmentFailed", async () => {
    assessHeartRateBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const result = await ingestReadings(fakeSvc().svc, target, [pulse()]);

    expect(result.vitalsInserted).toBe(1);
    expect(result.safetyAssessmentFailed).toBe(true);
    expect(captureException.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        extra: expect.objectContaining({ stage: "safety_assessment", assessor: "heart_rate" }),
      })
    );
  });

  it("still runs the heart-rate assessment even when the BP assessment failed first", async () => {
    // One assessor failing must not skip the other — they're independent
    // red-flag checks on independent data.
    assessBpControlBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    await ingestReadings(fakeSvc().svc, target, [bp(), pulse()]);

    expect(assessHeartRateBestEffort).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("reports safetyAssessmentFailed: false when both assessments succeed", async () => {
    const result = await ingestReadings(fakeSvc().svc, target, [bp(), pulse()]);

    expect(result.safetyAssessmentFailed).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("still surfaces a genuine storage failure as WearableIngestError even when an assessment also fails", async () => {
    // Before this fix, an uncaught assess exception pre-empted the final
    // "if (failure) throw" check entirely — a real data-loss failure
    // (the BP row here) would never reach the caller at all, because the
    // assess exception propagated first. This proves both facts survive
    // together: the storage failure is still reported (not masked), and the
    // pulse assessment failure is still recorded on the thrown error's own
    // result.
    const { svc } = fakeSvc({ failOn: { ids: ["bp1"], code: "42501", message: "permission denied" } });
    assessHeartRateBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    let caught: WearableIngestError | null = null;
    try {
      await ingestReadings(svc, target, [bp(), pulse()]);
    } catch (error) {
      caught = error as WearableIngestError;
    }

    expect(caught).toBeInstanceOf(WearableIngestError);
    expect(caught?.result.failed).toBe(1);
    expect(caught?.result.vitalsInserted).toBe(1);
    expect(caught?.result.safetyAssessmentFailed).toBe(true);
  });
});
