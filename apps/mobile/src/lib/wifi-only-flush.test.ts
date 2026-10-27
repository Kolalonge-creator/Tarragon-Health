/**
 * S06z: "sync on Wi-Fi only" through the real outbox. Only a dose log and a weight reading wait on mobile data;
 * every other reading, every symptom and anything flagged danger never does. Nothing waits past its deadline.
 */
import { postVitalReading, type VitalReadingPayload } from "./api";
import { __resetOutboxForTests, countHeldForWifi, enqueue, flushOutbox, flushOutboxIncludingHeld, getPendingCount } from "./outbox";
import { __resetWifiOnlyForTests, writeWifiOnly } from "./wifi-only";
import type { ConnectionKind } from "./data-cost-rules";
import { getUsageFigures } from "./data-usage";

let mockConnection: ConnectionKind = "cellular";
jest.mock("./connection-kind", () => ({
  ...(jest.requireActual("./connection-kind") as object),
  getConnectionKind: async () => mockConnection,
}));

const mockInserts: { table: string }[] = [];
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async () => {
        mockInserts.push({ table });
        return { error: null };
      },
    }),
  },
}));

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn(),
}));
const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;

const WEIGHT: VitalReadingPayload = { vital_type: "weight", weight_kg: 70 };
const BP: VitalReadingPayload = { vital_type: "blood_pressure", systolic: 120, diastolic: 80 };
const PULSE: VitalReadingPayload = { vital_type: "pulse", pulse_bpm: 38 };
const SYMPTOM = { symptom_type: "headache", severity: 4, description: null };

/** A dose that was due `hoursAgo` hours ago (Lagos wall clock, which is UTC+1). */
function doseDue(hoursAgo: number) {
  const iso = new Date(Date.now() - hoursAgo * 3_600_000 + 3_600_000).toISOString();
  return {
    medication_id: "med-1",
    scheduled_time: iso.slice(11, 16),
    scheduled_for_date: iso.slice(0, 10),
    status: "taken",
    organisation_id: "org-1",
  };
}

/** Moves only the clock forward; timers keep running for the async code. */
function advanceClock(hours: number): void {
  jest.useFakeTimers({
    now: Date.now() + hours * 3_600_000,
    doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "queueMicrotask", "performance"],
  });
}

beforeEach(() => {
  __resetOutboxForTests();
  __resetWifiOnlyForTests();
  mockInserts.length = 0;
  mockConnection = "cellular";
  mockPost.mockResolvedValue({ success: true });
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Wi-Fi only on, phone on mobile data", () => {
  beforeEach(async () => {
    await writeWifiOnly(true);
  });

  it("holds a weight reading and a dose log, shows them as waiting, and sends them once the phone reaches Wi-Fi", async () => {
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    await enqueue({ kind: "dose", subjectId: "p1", payload: doseDue(1) });
    const held = await flushOutbox();
    expect(held).toMatchObject({ synced: 0, heldForWifi: 2, remaining: 2, stoppedOffline: false });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockInserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(2);
    expect(await countHeldForWifi()).toBe(2);

    mockConnection = "wifi";
    expect(await countHeldForWifi()).toBe(0);
    const sent = await flushOutbox();
    expect(sent).toMatchObject({ synced: 2, heldForWifi: 0, remaining: 0 });
    expect(await getPendingCount()).toBe(0);
  });

  it("never holds a blood pressure, a pulse or any other reading, flagged or not", async () => {
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await enqueue({ kind: "vital", subjectId: "p1", payload: PULSE });
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT, danger: true });
    const result = await flushOutbox();
    expect(result).toMatchObject({ synced: 3, heldForWifi: 0, remaining: 0 });
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  it("never holds a danger-flagged dose log", async () => {
    await enqueue({ kind: "dose", subjectId: "p1", payload: doseDue(1), danger: true });
    expect(await flushOutbox()).toMatchObject({ synced: 1, heldForWifi: 0 });
  });

  it("never holds a symptom, even when it is not flagged", async () => {
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    const result = await flushOutbox();
    expect(result).toMatchObject({ synced: 1, heldForWifi: 0, remaining: 0 });
    expect(mockInserts.map((i) => i.table)).toEqual(["symptoms"]);
  });

  it("holds an ordinary entry but sends the urgent one logged after it, in the same run", async () => {
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    const result = await flushOutbox();
    expect(result).toMatchObject({ heldForWifi: 1 });
    expect(mockInserts.map((i) => i.table)).toEqual(["symptoms"]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("stops holding after the cap, so an entry cannot wait for ever", async () => {
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    expect((await flushOutbox()).heldForWifi).toBe(1);
    advanceClock(7); // the cap is six hours
    expect(await flushOutbox()).toMatchObject({ synced: 1, heldForWifi: 0 });
  });

  it("never lets a held dose log arrive after the server writes 'missed' for that dose", async () => {
    // Taken late: due 9 hours ago. The server marks it missed 12 hours after it was due, so it may wait about 2 more hours.
    await enqueue({ kind: "dose", subjectId: "p1", payload: doseDue(9) });
    expect((await flushOutbox()).heldForWifi).toBe(1);
    advanceClock(2.5);
    expect(await flushOutbox()).toMatchObject({ synced: 1, heldForWifi: 0 });
  });

  it("does not hold a dose that is already close to the server's missed window", async () => {
    await enqueue({ kind: "dose", subjectId: "p1", payload: doseDue(11.5) });
    expect(await flushOutbox()).toMatchObject({ synced: 1, heldForWifi: 0 });
  });

  it("Send now on mobile data sends what was held, for that run only", async () => {
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    await enqueue({ kind: "dose", subjectId: "p1", payload: doseDue(1) });
    expect((await flushOutbox()).heldForWifi).toBe(2);
    expect(await flushOutboxIncludingHeld()).toMatchObject({ synced: 2, heldForWifi: 0, remaining: 0 });
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    expect((await flushOutbox()).heldForWifi).toBe(1);
  });

  it("two Send now taps at once, or a flush alongside one, cannot put a row in flight twice or hold what was asked for", async () => {
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    await enqueue({ kind: "dose", subjectId: "p1", payload: doseDue(1) });
    const [a, b, c] = await Promise.all([flushOutboxIncludingHeld(), flushOutboxIncludingHeld(), flushOutbox()]);
    expect(a.synced + b.synced).toBe(2);
    expect(c.heldForWifi).toBe(0);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockInserts).toHaveLength(1);
    expect(await getPendingCount()).toBe(0);
  });

  it.each<ConnectionKind>(["unknown", "other"])("a %s connection holds nothing (only known mobile data does)", async (connection) => {
    mockConnection = connection;
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    expect(await flushOutbox()).toMatchObject({ synced: 1, heldForWifi: 0 });
  });
});

describe("the meter counts a run once, against the connection it used", () => {
  it("one count per run, on mobile data", async () => {
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await flushOutbox();
    const figures = await getUsageFigures();
    expect(figures.monthBytes).toBeGreaterThan(0);
    expect(figures.unplacedBytes).toBe(0);
    expect(figures.lastSync?.bytes).toBe(figures.monthBytes);
  });

  it("a run on Wi-Fi adds nothing to the mobile figure", async () => {
    mockConnection = "wifi";
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await flushOutbox();
    expect((await getUsageFigures()).monthBytes).toBe(0);
  });
});

describe("Wi-Fi only off, or never chosen", () => {
  it("sends everything on mobile data as before", async () => {
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    await enqueue({ kind: "dose", subjectId: "p1", payload: doseDue(1) });
    expect(await flushOutbox()).toMatchObject({ synced: 2, heldForWifi: 0, remaining: 0 });
    expect(await countHeldForWifi()).toBe(0);
  });

  it("an unreadable saved choice means send, never hold", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const storage = require("@react-native-async-storage/async-storage").default as { getItem: (k: string) => Promise<string | null> };
    const spy = jest.spyOn(storage, "getItem").mockRejectedValue(new Error("storage down"));
    await enqueue({ kind: "vital", subjectId: "p1", payload: WEIGHT });
    expect(await flushOutbox()).toMatchObject({ synced: 1, heldForWifi: 0 });
    spy.mockRestore();
  });
});
