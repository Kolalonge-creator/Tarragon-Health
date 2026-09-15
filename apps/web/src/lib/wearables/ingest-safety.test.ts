import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ingestReadings, WearableIngestError } from "./ingest";
import type { NormalisedReading, WearableConsent } from "./normalise";

/**
 * Two confirmed defects on the wearable ingestion path, both of which lost a
 * dangerous reading without anything looking wrong:
 *
 *  1. a consent switch the patient holds a column-level UPDATE grant on
 *     stopped a resting-heart-rate (or weight) reading from ever reaching
 *     vitals_readings, so vitals_readings_pulse_red_flag and
 *     vitals_readings_heart_failure_weight_gain never fired;
 *  2. every non-duplicate insert error was swallowed into `{ inserted: 0 }`
 *     and reported as a clean sync.
 *
 * These are the regression tests for both, plus the respiratory-rate routing
 * that used to strand the metric in wearable_readings.
 */

type InsertedRow = Record<string, unknown>;

interface FakeOptions {
  /** Rows whose external_reading_id matches fail with this error. */
  failOn?: { ids: string[]; code: string; message: string };
  /** Rows whose external_reading_id matches collide on the dedupe index. */
  duplicateOn?: string[];
}

/**
 * Records what each table was actually handed, and which tables were read.
 *
 * Reads matter here because assessHeartRateBestEffort is not mocked: it is
 * the real function, and its trailing-window SELECT on vitals_readings is
 * the observable proof that a consent-denied pulse reading still reached the
 * assessment path. It returns early on an empty window, so nothing else runs.
 */
function fakeSvc(options: FakeOptions = {}) {
  const inserted: Record<string, InsertedRow[]> = { vitals_readings: [], wearable_readings: [] };
  const selected: string[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  const errorFor = (rows: InsertedRow[]): { code: string; message: string } | null => {
    for (const row of rows) {
      const id = String(row.external_reading_id ?? "");
      if (options.failOn?.ids.includes(id)) {
        return { code: options.failOn.code, message: options.failOn.message };
      }
      if (options.duplicateOn?.includes(id)) {
        return { code: "23505", message: "duplicate key value violates unique constraint" };
      }
    }
    return null;
  };

  const emptyQuery = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      then: (resolve: (value: { data: never[]; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    };
    return builder;
  };

  const svc = {
    from: (table: string) => ({
      insert: async (rows: InsertedRow[]) => {
        const error = errorFor(rows);
        if (error) return { error };
        inserted[table]?.push(...rows);
        return { error: null };
      },
      select: (...args: unknown[]) => {
        selected.push(table);
        return emptyQuery().select(...(args as []));
      },
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: true, error: null };
    },
  };

  return { svc: svc as unknown as SupabaseClient<Database>, inserted, selected, rpcCalls };
}

const target = { connectionId: "c1", organisationId: "o1", patientId: "p1" };

function build(
  readingType: NormalisedReading["readingType"],
  value: number,
  id: string = readingType
): NormalisedReading {
  return {
    readingType,
    value,
    unit: "x",
    recordedAt: "2026-09-05T08:00:00.000Z",
    externalReadingId: id,
  };
}

const denyAll: WearableConsent = {
  activity: false,
  heart_rate: false,
  sleep: false,
  weight: false,
};

describe("a denied consent category never disables a red-flag classifier", () => {
  it("still writes a resting heart rate to vitals_readings when heart_rate consent is off", async () => {
    // 178 bpm with consent_heart_rate = false used to be counted as
    // deniedByConsent and dropped, so vitals_readings_pulse_red_flag never
    // saw it. A patient-flippable switch must not turn off their own
    // dangerous-heart-rate detection.
    const { svc, inserted } = fakeSvc();
    const result = await ingestReadings(svc, { ...target, consent: denyAll }, [
      build("resting_heart_rate", 178),
    ]);

    expect(inserted.vitals_readings).toHaveLength(1);
    expect(inserted.vitals_readings[0]).toMatchObject({
      vital_type: "pulse",
      source: "wearable",
      pulse_bpm: 178,
    });
    expect(result.vitalsInserted).toBe(1);
    expect(result.deniedByConsent).toBe(1);
    expect(result.consentDeniedSafetyRetained).toBe(1);
  });

  it("runs the trailing-window heart-rate assessment for a consent-denied pulse reading", async () => {
    const { svc, selected } = fakeSvc();
    await ingestReadings(svc, { ...target, consent: denyAll }, [build("resting_heart_rate", 178)]);

    expect(selected).toContain("vitals_readings");
  });

  it("does not reach the heart-rate assessment when nothing pulse-shaped landed", async () => {
    // Control for the test above: the SELECT is a real signal, not something
    // every batch produces.
    const { svc, selected } = fakeSvc();
    await ingestReadings(svc, target, [build("hrv_ms", 42)]);

    expect(selected).toHaveLength(0);
  });

  it("still writes a weight to vitals_readings when weight consent is off", async () => {
    // Same defect on the other side: consent_weight = false silenced the
    // heart-failure weight-gain trigger.
    const { svc, inserted } = fakeSvc();
    const result = await ingestReadings(svc, { ...target, consent: denyAll }, [
      build("weight", 91.4),
    ]);

    expect(inserted.vitals_readings).toHaveLength(1);
    expect(inserted.vitals_readings[0]).toMatchObject({ vital_type: "weight", weight_kg: 91.4 });
    expect(result.consentDeniedSafetyRetained).toBe(1);
  });

  it("keeps the privacy intent for purely passive metrics", async () => {
    // HRV, sleep, steps and respiratory rate feed no classifier, so a denied
    // category still drops them outright — the consent toggle is not made
    // meaningless, only prevented from switching off a safety path.
    const { svc, inserted, rpcCalls } = fakeSvc();
    const result = await ingestReadings(svc, { ...target, consent: denyAll }, [
      build("hrv_ms", 42),
      build("sleep_minutes", 400),
      build("steps", 9412),
      build("respiratory_rate", 15),
    ]);

    expect(inserted.wearable_readings).toHaveLength(0);
    expect(inserted.vitals_readings).toHaveLength(0);
    expect(result.deniedByConsent).toBe(4);
    expect(result.consentDeniedSafetyRetained).toBe(0);
    expect(rpcCalls.filter((call) => call.fn === "record_wearable_step_count")).toHaveLength(0);
  });

  it("mixes both outcomes in one batch without either affecting the other", async () => {
    const { svc, inserted } = fakeSvc();
    const result = await ingestReadings(svc, { ...target, consent: denyAll }, [
      build("resting_heart_rate", 178),
      build("hrv_ms", 42),
    ]);

    expect(inserted.vitals_readings).toHaveLength(1);
    expect(inserted.wearable_readings).toHaveLength(0);
    expect(result.deniedByConsent).toBe(2);
    expect(result.consentDeniedSafetyRetained).toBe(1);
  });

  it("reports nothing denied when every category is granted", async () => {
    const { svc } = fakeSvc();
    const result = await ingestReadings(svc, target, [build("resting_heart_rate", 62)]);

    expect(result.deniedByConsent).toBe(0);
    expect(result.consentDeniedSafetyRetained).toBe(0);
  });
});

describe("respiratory rate routes to vitals_readings", () => {
  it("writes respiratory_rate_bpm rather than stranding it in wearable_readings", async () => {
    const { svc, inserted } = fakeSvc();
    const result = await ingestReadings(svc, target, [build("respiratory_rate", 15)]);

    expect(inserted.wearable_readings).toHaveLength(0);
    expect(inserted.vitals_readings[0]).toMatchObject({
      vital_type: "respiratory_rate",
      source: "wearable",
      respiratory_rate_bpm: 15,
      wearable_connection_id: "c1",
    });
    expect(result.vitalsInserted).toBe(1);
  });
});

describe("a failed insert is never reported as a clean sync", () => {
  it("throws with the real database error instead of returning zero", async () => {
    // `if (error.code !== "23505") return { inserted: 0, duplicates: 0 }` is
    // what made a permission failure indistinguishable from an empty batch.
    const { svc } = fakeSvc({
      failOn: { ids: ["resting_heart_rate"], code: "42501", message: "permission denied" },
    });

    await expect(
      ingestReadings(svc, target, [build("resting_heart_rate", 178)])
    ).rejects.toBeInstanceOf(WearableIngestError);
  });

  it("carries the error code, message and partial counts on the thrown error", async () => {
    const { svc } = fakeSvc({
      failOn: { ids: ["bad"], code: "42501", message: "permission denied" },
    });

    let caught: WearableIngestError | null = null;
    try {
      await ingestReadings(svc, target, [
        build("resting_heart_rate", 178, "bad"),
        build("spo2", 97, "good"),
      ]);
    } catch (error) {
      caught = error as WearableIngestError;
    }

    expect(caught).toBeInstanceOf(WearableIngestError);
    expect(caught?.code).toBe("42501");
    expect(caught?.message).toContain("permission denied");
    // A partial batch is still a failed batch, but what did land is counted
    // so the caller can record it.
    expect(caught?.result.vitalsInserted).toBe(1);
    expect(caught?.result.failed).toBe(1);
  });

  it("still commits the rows that succeeded alongside the one that failed", async () => {
    const { svc, inserted } = fakeSvc({
      failOn: { ids: ["bad"], code: "23514", message: "check constraint" },
    });

    await expect(
      ingestReadings(svc, target, [
        build("resting_heart_rate", 178, "bad"),
        build("spo2", 97, "good"),
      ])
    ).rejects.toBeInstanceOf(WearableIngestError);

    expect(inserted.vitals_readings).toHaveLength(1);
    expect(inserted.vitals_readings[0]).toMatchObject({ vital_type: "spo2" });
  });

  it("treats a 23505 as a genuine duplicate, not a failure", async () => {
    // Providers redeliver on purpose; a repeat is a silent success and must
    // stay one.
    const { svc } = fakeSvc({ duplicateOn: ["resting_heart_rate"] });
    const result = await ingestReadings(svc, target, [build("resting_heart_rate", 62)]);

    expect(result.failed).toBe(0);
    expect(result.vitalsInserted).toBe(0);
  });

  it("surfaces a failure on the passive table too", async () => {
    const { svc } = fakeSvc({
      failOn: { ids: ["hrv_ms"], code: "42501", message: "permission denied" },
    });

    await expect(ingestReadings(svc, target, [build("hrv_ms", 42)])).rejects.toBeInstanceOf(
      WearableIngestError
    );
  });

  it("reports failed = 0 and does not throw on a clean batch", async () => {
    const { svc } = fakeSvc();
    const result = await ingestReadings(svc, target, [build("spo2", 97)]);

    expect(result.failed).toBe(0);
    expect(result.vitalsInserted).toBe(1);
  });
});
