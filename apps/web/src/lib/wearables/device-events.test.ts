import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { recordDeviceSync } from "./device-events";
import { ingestReadings } from "./ingest";
import type { NormalisedReading } from "./normalise";

function fakeSvc(opts: { rpcError?: { message: string } } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const svc = {
    from: () => ({ insert: async () => ({ error: null }) }),
    rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "record_device_sync" && opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: true, error: null };
    }),
  };
  return { svc: svc as unknown as SupabaseClient<Database>, calls };
}

const weight = (kg: number, at: string): NormalisedReading => ({ readingType: "weight", value: kg, unit: "kg", recordedAt: at, externalReadingId: `w:${at}` });
const target = { connectionId: "c1", organisationId: "o1", patientId: "p1" };

describe("device.synced (ids and counts only)", () => {
  it("records provider, kind and counts, and nothing about the values", async () => {
    const { svc, calls } = fakeSvc();
    await recordDeviceSync(svc, { patientId: "p1", provider: "fitbit", sourceKind: "wearable_cloud", readingCount: 3, duplicateCount: 1 });
    expect(calls).toEqual([
      { fn: "record_device_sync", args: { p_patient: "p1", p_provider: "fitbit", p_source_kind: "wearable_cloud", p_reading_count: 3, p_duplicate_count: 1 } },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/kg|mmHg|mmol|value/i);
  });
  it("records nothing for an empty sync", async () => {
    const { svc, calls } = fakeSvc();
    await recordDeviceSync(svc, { patientId: "p1", provider: "fitbit", sourceKind: "wearable_cloud", readingCount: 0 });
    expect(calls).toHaveLength(0);
  });
  it("reports a bus failure to the caller as an error", async () => {
    const { svc } = fakeSvc({ rpcError: { message: "bus down" } });
    await expect(recordDeviceSync(svc, { patientId: "p1", provider: "x", sourceKind: "ble", readingCount: 1 })).rejects.toThrow(/device.synced was not recorded/);
  });
});

describe("ingestReadings emits device.synced only when asked to", () => {
  it("emits one event with the stored count when a provider and kind are given", async () => {
    const { svc, calls } = fakeSvc();
    await ingestReadings(svc, { ...target, provider: "garmin", syncKind: "wearable_cloud" }, [weight(72, "2026-10-01T08:00:00Z"), weight(72.4, "2026-10-02T08:00:00Z")]);
    const sync = calls.filter((c) => c.fn === "record_device_sync");
    expect(sync).toHaveLength(1);
    expect(sync[0]?.args).toMatchObject({ p_provider: "garmin", p_source_kind: "wearable_cloud", p_reading_count: 2 });
  });
  it("emits nothing for a caller that does not name a provider (every older caller)", async () => {
    const { svc, calls } = fakeSvc();
    await ingestReadings(svc, target, [weight(72, "2026-10-01T08:00:00Z")]);
    expect(calls.filter((c) => c.fn === "record_device_sync")).toHaveLength(0);
  });
  it("a failed event never fails the sync that already stored its readings", async () => {
    const { svc } = fakeSvc({ rpcError: { message: "bus down" } });
    const result = await ingestReadings(svc, { ...target, provider: "garmin", syncKind: "wearable_cloud" }, [weight(72, "2026-10-01T08:00:00Z")]);
    expect(result.vitalsInserted).toBe(1);
    expect(result.failed).toBe(0);
  });
});
