/**
 * S13 R4 (CMO Q13): the patient's "I have sought care / I could not get care" answer goes through the offline outbox and the
 * database function, idempotent by the outbox client id, oldest first behind the reading that raised the alert.
 */
import { postVitalReading, type VitalReadingPayload } from "./api";
import { getStore } from "./secure-db";
import { __resetOutboxForTests, enqueue, flushOutbox, getPendingCount, listOutbox } from "./outbox";
import { answerRedCare } from "./red-care";

let mockSessionUser: string | null = "user-1";
const mockRpcs: { fn: string; args: Record<string, unknown> }[] = [];
let mockRpcError: { code?: string; message?: string } | null = null;

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockSessionUser ? { user: { id: mockSessionUser } } : null } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockRpcs.push({ fn, args });
      return { error: mockRpcError };
    },
  },
}));
jest.mock("./api", () => ({ ...(jest.requireActual("./api") as object), postVitalReading: jest.fn() }));
const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;
const BP: VitalReadingPayload = { vital_type: "blood_pressure", systolic: 185, diastolic: 125 };

beforeEach(async () => {
  __resetOutboxForTests();
  mockSessionUser = "user-1";
  mockRpcs.length = 0;
  mockRpcError = null;
  mockPost.mockReset();
  await getPendingCount();
  const db = await getStore();
  await db.runAsync("delete from outbox");
});

describe("red care answer through the outbox", () => {
  it("is durable on the phone before any network call and flagged urgent", async () => {
    const item = await enqueue({ kind: "red_care", subjectId: "p1", payload: { response: "could_not_get_care" }, danger: true });
    expect(mockRpcs).toHaveLength(0);
    expect(item.danger).toBe(true);
    expect(await getPendingCount()).toBe(1);
  });

  it("sends the database function with the outbox client id and the answer", async () => {
    const item = await enqueue({ kind: "red_care", subjectId: "p1", payload: { response: "sought_care" } });
    await flushOutbox();
    expect(mockRpcs).toHaveLength(1);
    expect(mockRpcs[0]).toMatchObject({ fn: "record_red_care_response", args: { p_client_id: item.clientId, p_response: "sought_care" } });
    expect(await getPendingCount()).toBe(0);
  });

  it("a blind retry after a lost reply sends the same client id again, never a new one", async () => {
    await enqueue({ kind: "red_care", subjectId: "p1", payload: { response: "sought_care" } });
    mockRpcError = { message: "Network request failed" };
    await flushOutbox();
    mockRpcError = null;
    await flushOutbox();
    expect(mockRpcs).toHaveLength(2);
    expect(mockRpcs[0]?.args["p_client_id"]).toBe(mockRpcs[1]?.args["p_client_id"]);
  });

  it("a red alert that has not reached the server yet (P0002) is retried, not rejected", async () => {
    await enqueue({ kind: "red_care", subjectId: "p1", payload: { response: "sought_care" } });
    mockRpcError = { code: "P0002", message: "no red alert to answer yet" };
    await flushOutbox();
    const [row] = await listOutbox("red_care");
    expect(row?.state).toBe("pending");
  });

  it("goes after the reading that raised the alert (oldest first)", async () => {
    mockPost.mockResolvedValue({ success: true });
    const order: string[] = [];
    mockPost.mockImplementation(async () => {
      order.push("reading");
      return { success: true };
    });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP, danger: true });
    await new Promise((r) => setTimeout(r, 5));
    await enqueue({ kind: "red_care", subjectId: "p1", payload: { response: "could_not_get_care" }, danger: true });
    mockRpcs.length = 0;
    await flushOutbox();
    expect(order).toEqual(["reading"]);
    expect(mockRpcs).toHaveLength(1);
  });

  it("holds under another account: a row is never sent as someone else", async () => {
    await enqueue({ kind: "red_care", subjectId: "p1", payload: { response: "sought_care" } });
    mockSessionUser = "user-2";
    await expect(flushOutbox()).resolves.toMatchObject({ held: 1, synced: 0 });
    expect(mockRpcs).toHaveLength(0);
  });
});

describe("answerRedCare", () => {
  it("returns saved when the send went through", async () => {
    await expect(answerRedCare("user-1", "sought_care")).resolves.toBe("saved");
  });
  it("returns queued, keeping the row, when the phone is offline", async () => {
    mockRpcError = { message: "Network request failed" };
    await expect(answerRedCare("user-1", "could_not_get_care")).resolves.toBe("queued");
    expect(await getPendingCount()).toBe(1);
  });
  it("returns failed, and saves nothing, when nobody is signed in", async () => {
    mockSessionUser = null;
    await expect(answerRedCare("user-1", "sought_care")).resolves.toBe("failed");
  });
  it("returns queued when the sync itself throws", async () => {
    const port = {
      enqueue: async () => ({ clientId: "c1" }) as never,
      flush: async () => {
        throw new Error("boom");
      },
    };
    await expect(answerRedCare("user-1", "sought_care", port)).resolves.toBe("queued");
  });
  it("returns failed, not queued, when the server refused the answer (a rejected row will never go)", async () => {
    mockRpcError = { code: "42501", message: "this red event is not yours" };
    await expect(answerRedCare("user-1", "could_not_get_care")).resolves.toBe("failed");
  });
  it("returns saved when the row is gone from the queue after the flush", async () => {
    const port = { enqueue: async () => ({ clientId: "c1" }) as never, flush: (async () => ({})) as never };
    await expect(answerRedCare("user-1", "sought_care", port)).resolves.toBe("saved");
  });
});
