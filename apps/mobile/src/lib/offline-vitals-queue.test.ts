/**
 * The offline vitals queue is the app's promise that a reading a patient
 * typed in is never lost to a dropped connection (MOBILE_APP_SPEC.md §6).
 * These tests cover that promise, and — deliberately — also pin the two
 * places where the current behaviour is NOT what a reader would assume, so
 * that a future fix shows up as a failing expectation to update rather than
 * as an invisible behaviour change. Both are called out in the file's own
 * FINDING comments below.
 */
import { NETWORK_ERROR_MESSAGE, postVitalReading, type VitalReadingPayload } from "./api";
import { openDatabaseAsync } from "../test/mocks/expo-sqlite";
import {
  enqueueVitalReading,
  flushPendingVitals,
  getPendingCount,
  getPendingVitals,
} from "./offline-vitals-queue";

jest.mock("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) } },
}));

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn(),
}));

const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;

const BP: VitalReadingPayload = { vital_type: "blood_pressure", systolic: 210, diastolic: 130 };
const WEIGHT: VitalReadingPayload = { vital_type: "weight", weight_kg: 74 };

/** Reads the columns the module writes but never exposes. */
async function rawRows(): Promise<
  { client_id: string; attempts: number; last_error: string | null; state: string }[]
> {
  const db = await openDatabaseAsync("tarragon-offline.db");
  return db.getAllAsync("select client_id, attempts, last_error, state from outbox order by created_at asc");
}

describe("enqueueVitalReading", () => {
  it("makes the reading durable before any network call happens", async () => {
    const queued = await enqueueVitalReading(BP);

    expect(mockPost).not.toHaveBeenCalled();
    expect(await getPendingCount()).toBe(1);
    expect((await getPendingVitals())[0]).toMatchObject({
      clientReadingId: queued.clientReadingId,
      payload: BP,
    });
  });

  it("carries the acting-for beneficiary through the queue, not just through the live call", async () => {
    await enqueueVitalReading(BP, "beneficiary-1");
    expect((await getPendingVitals())[0].beneficiaryProfileId).toBe("beneficiary-1");
  });

  it("gives every reading its own idempotency key", async () => {
    const a = await enqueueVitalReading(BP);
    const b = await enqueueVitalReading(BP);
    expect(a.clientReadingId).not.toBe(b.clientReadingId);
  });
});

describe("flushPendingVitals", () => {
  it("removes each reading the server accepted and reports the count", async () => {
    await enqueueVitalReading(BP);
    await enqueueVitalReading(WEIGHT);
    mockPost.mockResolvedValue({ success: true });

    await expect(flushPendingVitals()).resolves.toEqual({ synced: 2, remaining: 0, stoppedOffline: false });
    expect(await getPendingCount()).toBe(0);
  });

  it("replays the same client_reading_id, so a retry after a dropped reply is a server-side no-op", async () => {
    const queued = await enqueueVitalReading(BP);
    mockPost.mockResolvedValue({ success: false, error: NETWORK_ERROR_MESSAGE });
    await flushPendingVitals();
    mockPost.mockResolvedValue({ success: true });
    await flushPendingVitals();

    // Same key AND same device time on every replay: the time the patient logged it.
    expect(mockPost).toHaveBeenNthCalledWith(1, BP, undefined, queued.clientReadingId, queued.createdAt);
    expect(mockPost).toHaveBeenNthCalledWith(2, BP, undefined, queued.clientReadingId, queued.createdAt);
  });

  it("stops the whole run on a network failure and keeps everything queued", async () => {
    await enqueueVitalReading(BP);
    await enqueueVitalReading(WEIGHT);
    mockPost.mockResolvedValue({ success: false, error: NETWORK_ERROR_MESSAGE });

    await expect(flushPendingVitals()).resolves.toEqual({ synced: 0, remaining: 2, stoppedOffline: true });
    // One attempt, not two — hammering a connection that is clearly down
    // would just burn the background task's execution window.
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(await getPendingCount()).toBe(2);
  });

  it("does not let one server-rejected reading block the readings behind it", async () => {
    await enqueueVitalReading(BP);
    await enqueueVitalReading(WEIGHT);
    mockPost
      .mockResolvedValueOnce({ success: false, error: "Invalid systolic value", status: 400 })
      .mockResolvedValueOnce({ success: true });

    await expect(flushPendingVitals()).resolves.toMatchObject({ synced: 1, stoppedOffline: false });
    const rows = await rawRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].last_error).toBe("Invalid systolic value");
  });

  /**
   * S06 fixed the old FINDING (a reading the server will never accept was
   * retried forever, with no terminal state). A 4xx refusal now moves the row
   * to a terminal `rejected` state: it is kept (never dropped), no longer
   * retried automatically, and visible to the patient and support.
   */
  it("moves a permanently-rejected reading to a terminal state and keeps it", async () => {
    await enqueueVitalReading(BP);
    mockPost.mockResolvedValue({ success: false, error: "Request failed (400)", status: 400 });

    const first = await flushPendingVitals();
    expect(first).toEqual({ synced: 0, remaining: 1, stoppedOffline: false });
    for (let i = 0; i < 3; i++) await flushPendingVitals();

    // Sent exactly once: a rejected row is not hammered.
    expect(mockPost).toHaveBeenCalledTimes(1);
    const rows = await rawRows();
    expect(rows[0]).toMatchObject({ state: "rejected", attempts: 1, last_error: "Request failed (400)" });
    expect(await getPendingCount()).toBe(1);
  });

  it("returns cleanly on an empty queue", async () => {
    await expect(flushPendingVitals()).resolves.toEqual({ synced: 0, remaining: 0, stoppedOffline: false });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
