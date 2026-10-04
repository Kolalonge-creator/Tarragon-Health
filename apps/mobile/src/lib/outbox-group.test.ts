/**
 * S07: one blood pressure log writes several outbox rows (the reading, a
 * companion pulse, ticked symptoms). They are saved as one unit, keep their
 * order, and a row that has not gone is never lost behind one that has.
 */
import * as Crypto from "expo-crypto";
import { postVitalReading, type VitalReadingPayload } from "./api";
import { openDatabaseAsync } from "../test/mocks/expo-sqlite";
import { __resetOutboxForTests, discardRejectedRow, enqueue, enqueueGroup, flushOutbox, listOutbox } from "./outbox";

const order: string[] = [];
let mockInsertError: { code?: string; message?: string } | null = null;

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async () => {
        order.push(table);
        return { error: mockInsertError };
      },
    }),
  },
}));

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn(),
}));
const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;

const BP: VitalReadingPayload = { vital_type: "blood_pressure", systolic: 185, diastolic: 118 };
const PULSE: VitalReadingPayload = { vital_type: "pulse", pulse_bpm: 96 };
const HEADACHE = { symptom_type: "severe_headache", severity: 6, description: "Ticked on the blood pressure form (not rated by the patient)." };

beforeEach(() => {
  order.length = 0;
  mockInsertError = null;
  mockPost.mockReset();
  mockPost.mockImplementation(async () => {
    order.push("vital");
    return { success: true };
  });
});

// First on purpose: a phone that installed the outbox before this change has the table without group_id.
describe("a phone whose outbox predates group_id", () => {
  it("gets the column added, keeps its old rows, and can then save a group", async () => {
    __resetOutboxForTests();
    const db = await openDatabaseAsync("tarragon-offline.db");
    await db.execAsync(
      `create table outbox (
        client_id text primary key, kind text not null, owner_user_id text not null, subject_id text not null,
        beneficiary_profile_id text, payload text not null, client_recorded_at text not null, created_at text not null,
        attempts integer not null default 0, next_attempt_at text not null, state text not null default 'pending',
        last_error text, last_status integer, danger integer not null default 0
      )`,
    );
    await db.runAsync(
      "insert into outbox (client_id, kind, owner_user_id, subject_id, payload, client_recorded_at, created_at, next_attempt_at) values (?,?,?,?,?,?,?,?)",
      ["old-row", "vital", "user-1", "p1", JSON.stringify(BP), "2026-10-01T08:00:00.000Z", "2026-10-01T08:00:00.000Z", "2026-10-01T08:00:00.000Z"],
    );
    const items = await enqueueGroup([{ kind: "vital", subjectId: "p1", payload: PULSE }]);
    expect(items[0]?.groupId).toBeDefined();
    const all = await listOutbox();
    expect(all.map((r) => r.clientId)).toContain("old-row");
    expect(all.find((r) => r.clientId === "old-row")?.groupId).toBeUndefined();
  });
});

describe("enqueueGroup", () => {
  it("saves every row, in the order given, under one group id", async () => {
    const before = (await listOutbox()).length;
    const items = await enqueueGroup([
      { kind: "symptom", subjectId: "p1", payload: HEADACHE, danger: true },
      { kind: "vital", subjectId: "p1", payload: BP, danger: true },
      { kind: "vital", subjectId: "p1", payload: PULSE },
    ]);
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.groupId)).size).toBe(1);
    expect(items.map((i) => i.kind)).toEqual(["symptom", "vital", "vital"]);
    const stored = (await listOutbox()).slice(before);
    expect(stored.map((r) => r.clientId)).toEqual(items.map((i) => i.clientId));
    expect(stored.map((r) => r.danger)).toEqual([true, true, false]);
  });

  it("saves nothing when one row fails part-way (all or none)", async () => {
    const before = (await listOutbox()).length;
    const uuid = jest.spyOn(Crypto, "randomUUID");
    uuid.mockReturnValueOnce("00000000-0000-4000-8000-0000000000aa" as never); // group id
    uuid.mockReturnValueOnce("00000000-0000-4000-8000-0000000000bb" as never);
    uuid.mockReturnValueOnce("00000000-0000-4000-8000-0000000000bb" as never); // same primary key: the 2nd insert fails
    await expect(
      enqueueGroup([
        { kind: "symptom", subjectId: "p1", payload: HEADACHE },
        { kind: "vital", subjectId: "p1", payload: BP },
      ]),
    ).rejects.toThrow();
    uuid.mockRestore();
    expect((await listOutbox()).length).toBe(before);
  });

  it("does nothing for an empty group", async () => {
    expect(await enqueueGroup([])).toEqual([]);
  });

  it("sends a red-flag symptom before the reading it was saved with", async () => {
    const before = (await listOutbox()).length;
    await enqueueGroup([
      { kind: "symptom", subjectId: "p1", payload: HEADACHE, danger: true },
      { kind: "vital", subjectId: "p1", payload: BP },
    ]);
    order.length = 0;
    const res = await flushOutbox();
    expect(res.synced).toBe(before + 2);
    const mine = order.slice(-2);
    expect(mine).toEqual(["symptoms", "vital"]);
  });

  it("keeps a refused member listed with its group id while the others go through", async () => {
    // Clear whatever the earlier tests left, so only this group is in play.
    await flushOutbox();
    for (const row of await listOutbox()) {
      if (row.state === "rejected") await discardRejectedRow(row.clientId);
    }
    mockInsertError = { code: "42501", message: "row-level security" }; // the symptom insert is refused
    const items = await enqueueGroup([
      { kind: "symptom", subjectId: "p1", payload: HEADACHE, danger: true },
      { kind: "vital", subjectId: "p1", payload: BP },
    ]);
    const res = await flushOutbox();
    expect(res.newlyRejected).toBe(1);
    const left = await listOutbox();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "symptom", state: "rejected", groupId: items[0]?.groupId, danger: true });
  });

  it("sends rows saved at different times oldest first", async () => {
    await flushOutbox();
    jest.useFakeTimers({ now: new Date("2026-10-02T08:00:00.000Z") });
    try {
      await enqueue({ kind: "symptom", subjectId: "p1", payload: HEADACHE });
      jest.setSystemTime(new Date("2026-10-02T08:01:00.000Z"));
      await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    } finally {
      jest.useRealTimers();
    }
    order.length = 0;
    await flushOutbox();
    expect(order).toEqual(["symptoms", "vital"]);
  });
});
