const rpc = jest.fn();
const eq = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from: () => ({ select: () => ({ eq }) }) }) }));

import { loadInbox, loadMyConcerns, loadReaders, loadRetaliationReviews, loadStaffNames } from "./load";

const ID = "11111111-1111-4111-8111-111111111111";
const row = {
  id: ID, raised_by: ID, raised_by_name: "A", category: "patient_safety", severity: "high", description: "x".repeat(30), screen: null, task_id: null, state: "new",
  created_at: "2026-10-06T10:00:00Z", acknowledge_due_at: "2026-10-08T10:00:00Z", respond_due_at: "2026-10-20T10:00:00Z", overdue: false, escalated_at: null, incident_id: null, messages: [],
};

beforeEach(() => { rpc.mockReset(); eq.mockReset(); });

describe("a failed read is a load failure, never an empty list", () => {
  it.each([
    ["inbox", loadInbox], ["mine", loadMyConcerns], ["retaliation", loadRetaliationReviews],
  ] as const)("%s: database error", async (_n, fn) => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await fn()).toEqual({ ok: false, denied: false });
  });
  it("a refusal is flagged as denied", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    expect(await loadRetaliationReviews()).toEqual({ ok: false, denied: true });
  });
  it("null or malformed data is a failure, not an empty inbox", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await loadInbox()).ok).toBe(false);
    rpc.mockResolvedValue({ data: [{ id: "x" }], error: null });
    expect((await loadInbox()).ok).toBe(false);
  });
  it("table reads fail the same way", async () => {
    eq.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect((await loadReaders()).ok).toBe(false);
    expect((await loadStaffNames()).ok).toBe(false);
  });
});

describe("good data", () => {
  it("an empty array is a real empty inbox", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await loadInbox()).toEqual({ ok: true, data: [] });
  });
  it("parses a row", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    const r = await loadInbox();
    expect(r.ok && r.data[0]?.id).toBe(ID);
  });
});
