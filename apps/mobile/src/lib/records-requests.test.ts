jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));

import { listRecordsRequests, markRequestReceived, overdueCount, setRequestNote, withdrawRequest } from "./records-requests";

const call = jest.fn();
beforeEach(() => call.mockReset());

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  facility_name: "Lagos General",
  scope_codes: ["lab_results"],
  state: "sent",
  requested_at: "2026-10-01T09:00:00Z",
  due_at: "2026-10-31T09:00:00Z",
  received_at: null,
  note: null,
  is_overdue: false,
  ...over,
});

describe("listRecordsRequests", () => {
  it("returns the person's rows from the patient function", async () => {
    call.mockResolvedValue({ data: [row(), row({ id: "r2", is_overdue: true })], error: null });
    const rows = await listRecordsRequests(call);
    expect(call).toHaveBeenCalledWith("my_records_requests");
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(overdueCount(rows)).toBe(1);
  });

  it("fails the whole read on a row it cannot read, so a request never quietly vanishes", async () => {
    for (const bad of [row({ state: "weird" }), { id: 5 }, null]) {
      call.mockResolvedValue({ data: [row(), bad], error: null });
      await expect(listRecordsRequests(call)).rejects.toThrow();
    }
  });

  it("throws on a failed read, so the screen cannot show an empty list as 'none'", async () => {
    call.mockResolvedValue({ data: null, error: { code: "XX000" } });
    await expect(listRecordsRequests(call)).rejects.toThrow();
    call.mockResolvedValue({ data: "nope", error: null });
    await expect(listRecordsRequests(call)).rejects.toThrow();
  });
});

describe("the actions", () => {
  it("call their patient functions with the id only", async () => {
    call.mockResolvedValue({ data: {}, error: null });
    await expect(markRequestReceived("r1", call)).resolves.toEqual({ ok: true });
    await expect(withdrawRequest("r1", call)).resolves.toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith("mark_records_request_received", { p_id: "r1" });
    expect(call).toHaveBeenCalledWith("withdraw_records_request", { p_id: "r1" });
  });

  it("report not_found for a request that is not theirs and failed for anything else, never ok", async () => {
    call.mockResolvedValue({ data: null, error: { code: "P0002" } });
    await expect(markRequestReceived("r1", call)).resolves.toEqual({ ok: false, reason: "not_found" });
    call.mockResolvedValue({ data: null, error: { code: "XX000" } });
    await expect(withdrawRequest("r1", call)).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("clears an empty note and caps a long one at 500", async () => {
    call.mockResolvedValue({ data: {}, error: null });
    await setRequestNote("r1", "   ", call);
    expect(call).toHaveBeenLastCalledWith("set_records_request_note", { p_id: "r1", p_note: null });
    await setRequestNote("r1", "x".repeat(600), call);
    expect((call.mock.calls.at(-1)?.[1] as { p_note: string }).p_note.length).toBe(500);
  });
});
