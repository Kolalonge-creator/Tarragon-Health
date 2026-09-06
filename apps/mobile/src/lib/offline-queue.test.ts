/**
 * The store-and-forward queues behind the two upload paths that would
 * otherwise drop a reading outright: health-store sync pages and BLE
 * clinical-device readings. Neither path has ever run against real hardware
 * (CLAUDE.md, Device & Wearable Integration), so these tests are the only
 * thing standing between a wiring mistake and a silently lost reading.
 */
import { postDeviceReading, postHealthSamples } from "./api";
import * as storage from "../test/mocks/async-storage";
import { getRecentSyncDiagnostics } from "./sync-diagnostics";
import {
  enqueueDeviceReading,
  enqueueHealthSamplesPage,
  flushDeviceReadingsQueue,
  flushHealthSamplesQueue,
  getDeviceReadingsQueueCount,
  getHealthSamplesQueueCount,
  getPendingCount,
  listPendingDeviceReadings,
  listPendingHealthSamplesPages,
} from "./offline-queue";

jest.mock("./api", () => ({
  postDeviceReading: jest.fn(),
  postHealthSamples: jest.fn(),
}));

const mockDevice = postDeviceReading as jest.MockedFunction<typeof postDeviceReading>;
const mockSamples = postHealthSamples as jest.MockedFunction<typeof postHealthSamples>;

const DEVICE_READINGS_QUEUE_KEY = "@tarragon/offline-queue/device-readings/v1";

function page(provider: "apple_health" | "android_health_connect", count: number) {
  return {
    provider,
    samples: Array.from({ length: count }, (_, i) => ({ type: "blood_pressure", value: i })),
  } as unknown as Parameters<typeof enqueueHealthSamplesPage>[0];
}

describe("queue isolation", () => {
  it("keeps the two queues in separate storage, so a burst in one cannot crowd out the other", async () => {
    await enqueueDeviceReading({ systolic: 150 });
    await enqueueHealthSamplesPage(page("apple_health", 3));

    expect(await getDeviceReadingsQueueCount()).toBe(1);
    expect(await getHealthSamplesQueueCount()).toBe(1);
    expect(await getPendingCount()).toBe(2);
  });
});

describe("enqueue", () => {
  it("persists the exact payload the live upload would have sent", async () => {
    await enqueueDeviceReading({ device_id: "d1", external_reading_id: "r1", systolic: 150 });
    expect((await listPendingDeviceReadings())[0].item).toEqual({
      device_id: "d1",
      external_reading_id: "r1",
      systolic: 150,
    });
  });

  it("reports false when the reading could not be sent AND could not be stored", async () => {
    // sync-screen.tsx relies on this to avoid telling a patient their
    // reading is safely queued when it is in fact gone.
    storage.__failNextSet();
    await expect(enqueueDeviceReading({ systolic: 150 })).resolves.toBe(false);
  });

  /**
   * FINDING (confirmed defect, drop policy left unchanged deliberately).
   *
   * MAX_QUEUE_SIZE is 500 per queue with a drop-oldest policy, so the 501st
   * reading enqueued during an outage permanently destroys the 1st. The
   * choice of drop-oldest over reject-new is well argued in the source (the
   * newest reading is the clinically freshest), but the discard is a real
   * loss of patient data with no server-side copy — it happens entirely
   * on-device, before anything has ever been uploaded.
   *
   * Changing the cap or the policy is a product decision (how much device
   * storage may a queue consume, and is losing the oldest reading acceptable
   * at all), so the behaviour is pinned here rather than altered. What DID
   * change: the discard now records a sync diagnostic instead of happening
   * completely silently — asserted below.
   */
  it("FINDING: silently destroys the oldest reading once 500 are queued", async () => {
    for (let i = 0; i < 500; i++) await enqueueDeviceReading({ seq: i });
    const before = await listPendingDeviceReadings();
    expect(before).toHaveLength(500);
    expect(before[0].item).toEqual({ seq: 0 });

    await enqueueDeviceReading({ seq: 500 });

    const after = await listPendingDeviceReadings();
    expect(after).toHaveLength(500);
    expect(after[0].item).toEqual({ seq: 1 }); // reading 0 is gone for good
    expect(after[499].item).toEqual({ seq: 500 });

    const overflow = getRecentSyncDiagnostics().filter((e) => e.detail === "offline_queue:overflow");
    expect(overflow).toHaveLength(1);
    expect(overflow[0].message).toContain("discarded 1 oldest entry");
  });
});

describe("reading a damaged queue", () => {
  it.each([
    ["a non-array value", '{"not":"an array"}'],
    ["unparseable JSON", "[[[["],
  ])("returns empty and records why for %s, rather than throwing on a sync", async (_label, raw) => {
    storage.__seedRaw(DEVICE_READINGS_QUEUE_KEY, raw);
    await expect(listPendingDeviceReadings()).resolves.toEqual([]);
  });

  it("keeps the good entries when one entry in the file is malformed", async () => {
    storage.__seedRaw(
      DEVICE_READINGS_QUEUE_KEY,
      JSON.stringify([
        { id: "a", enqueuedAt: "2026-09-05T00:00:00.000Z", item: { systolic: 150 } },
        { broken: true },
        { id: "c", enqueuedAt: "2026-09-05T00:01:00.000Z", item: { systolic: 160 } },
      ])
    );
    const entries = await listPendingDeviceReadings();
    expect(entries.map((e) => e.id)).toEqual(["a", "c"]);
  });
});

describe("flushDeviceReadingsQueue", () => {
  it("uploads oldest-first and removes each one that lands", async () => {
    await enqueueDeviceReading({ seq: 1 });
    await enqueueDeviceReading({ seq: 2 });
    mockDevice.mockResolvedValue({ success: true });

    await expect(flushDeviceReadingsQueue()).resolves.toEqual({ flushed: 2, remaining: 0 });
    expect(mockDevice).toHaveBeenNthCalledWith(1, { seq: 1 });
    expect(mockDevice).toHaveBeenNthCalledWith(2, { seq: 2 });
  });

  it("stops at the first failure and leaves the rest queued for the next run", async () => {
    await enqueueDeviceReading({ seq: 1 });
    await enqueueDeviceReading({ seq: 2 });
    await enqueueDeviceReading({ seq: 3 });
    mockDevice.mockResolvedValueOnce({ success: true }).mockResolvedValue({ success: false, error: "offline" });

    await expect(flushDeviceReadingsQueue()).resolves.toEqual({ flushed: 1, remaining: 2 });
    // Not four calls: the remaining two are not each burned through a ~20s
    // timeout against a connection already known to be down.
    expect(mockDevice).toHaveBeenCalledTimes(2);
    expect(getRecentSyncDiagnostics().some((e) => e.detail === "offline_queue:flush")).toBe(true);
  });

  /**
   * FINDING (the two defects above composing into total data loss).
   *
   * Stop-on-first-failure is the right policy for an OFFLINE device, but it
   * does not distinguish "offline" from "the server will never accept this
   * entry". A permanently-rejected reading — a 400 from
   * apps/web/src/lib/validation/device-reading.ts, e.g. the fabricated 1/0
   * mmHg a truncated GATT payload produces (see ble.test.ts) — sits at the
   * head of the queue and is retried first on every run, forever. Nothing
   * behind it ever uploads, however good the connection is.
   *
   * Combined with the drop-oldest cap: the poison entry is at index 0, so it
   * is also the FIRST thing overflow discards — which does eventually
   * unblock the queue, but only after 500 subsequent readings have been
   * discarded ahead of it. Between them the two behaviours turn one
   * malformed reading into an unbounded, silent loss of everything that
   * follows.
   *
   * Not fixed here: telling "permanently rejected" apart from "offline"
   * needs the flush to look at the failure (an HTTP status the api.ts result
   * type does not currently carry) or an attempt counter with a terminal
   * state, and both are the same product decision as the vitals queue's —
   * see offline-vitals-queue.test.ts.
   */
  it("FINDING: one permanently-rejected reading blocks every reading behind it, forever", async () => {
    await enqueueDeviceReading({ seq: "poison", systolic: 1, diastolic: 0 });
    await enqueueDeviceReading({ seq: "good-1" });
    await enqueueDeviceReading({ seq: "good-2" });
    mockDevice.mockResolvedValue({ success: false, error: "Systolic must be at least 60 mmHg" });

    for (let run = 0; run < 10; run++) {
      await expect(flushDeviceReadingsQueue()).resolves.toEqual({ flushed: 0, remaining: 3 });
    }

    // Every run retried the same head entry and never reached the two good
    // readings behind it.
    expect(mockDevice).toHaveBeenCalledTimes(10);
    expect(mockDevice).toHaveBeenLastCalledWith({ seq: "poison", systolic: 1, diastolic: 0 });
    expect((await listPendingDeviceReadings()).map((e) => e.item)).toEqual([
      { seq: "poison", systolic: 1, diastolic: 0 },
      { seq: "good-1" },
      { seq: "good-2" },
    ]);
  });
});

describe("flushHealthSamplesQueue", () => {
  it("counts samples, not pages, so a patient-facing message is honest", async () => {
    await enqueueHealthSamplesPage(page("apple_health", 4));
    await enqueueHealthSamplesPage(page("apple_health", 8));
    mockSamples.mockResolvedValue({
      ok: true,
      data: { vitals_inserted: 0, wearable_inserted: 0, implausible: 0, cursor: null },
    });

    await expect(flushHealthSamplesQueue()).resolves.toEqual({
      flushedPages: 2,
      flushedSamples: 12,
      remaining: 0,
    });
  });

  it("only touches the requested provider's pages, and reports remaining in the same scope", async () => {
    await enqueueHealthSamplesPage(page("android_health_connect", 2));
    await enqueueHealthSamplesPage(page("apple_health", 5));
    mockSamples.mockResolvedValue({
      ok: true,
      data: { vitals_inserted: 0, wearable_inserted: 0, implausible: 0, cursor: null },
    });

    await expect(flushHealthSamplesQueue("apple_health")).resolves.toEqual({
      flushedPages: 1,
      flushedSamples: 5,
      remaining: 0,
    });
    expect(mockSamples).toHaveBeenCalledTimes(1);
    // The other provider's page is untouched, not silently dropped.
    expect(await listPendingHealthSamplesPages()).toHaveLength(1);
  });

  it("leaves a page queued when the upload fails", async () => {
    await enqueueHealthSamplesPage(page("apple_health", 3));
    mockSamples.mockResolvedValue({ ok: false, error: "500" });

    await expect(flushHealthSamplesQueue()).resolves.toEqual({
      flushedPages: 0,
      flushedSamples: 0,
      remaining: 1,
    });
  });
});
