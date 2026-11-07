/**
 * HR Phase C leave actions: each field reaches the right parameter, a sickness reason is never sent for other leave, the
 * confirmed cancellation count is passed through, and only database sentences reach the page.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc })) }));

import { cancelLeave, decideLeave, requestLeave } from "./leave-actions";

const REQ = "11111111-1111-4111-8111-111111111111";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("requestLeave", () => {
  it("sends the request", async () => {
    expect((await requestLeave(undefined, form({ leaveType: "annual", startsOn: "2026-12-01", endsOn: "2026-12-05", note: "Trip" })))?.message).toMatch(/Request sent/);
    expect(rpc).toHaveBeenCalledWith("request_leave", {
      p_leave_type: "annual", p_starts_on: "2026-12-01", p_ends_on: "2026-12-05", p_note: "Trip", p_sickness_reason: null,
    });
  });

  it("drops a sickness reason typed against non-sick leave, and keeps it for sick leave", async () => {
    await requestLeave(undefined, form({ leaveType: "study", startsOn: "2026-12-01", endsOn: "2026-12-01", sicknessReason: "Migraine" }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_sickness_reason: null });
    await requestLeave(undefined, form({ leaveType: "sick", startsOn: "2026-11-05", endsOn: "2026-11-05", sicknessReason: "Migraine" }));
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_sickness_reason: "Migraine" });
  });

  it("refuses an end before the start before calling the database", async () => {
    expect((await requestLeave(undefined, form({ leaveType: "annual", startsOn: "2026-12-05", endsOn: "2026-12-01" })))?.error).toMatch(/last day/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("decideLeave", () => {
  it("passes the confirmed cancellation count with an approval", async () => {
    await decideLeave(undefined, form({ requestId: REQ, decision: "approved", expectedCancellations: "2", note: "" }));
    expect(rpc).toHaveBeenCalledWith("decide_leave", { p_request: REQ, p_decision: "approved", p_note: null, p_expected_cancellations: 2 });
  });

  it("needs a reason to decline", async () => {
    expect((await decideLeave(undefined, form({ requestId: REQ, decision: "rejected", expectedCancellations: "0", note: "no" })))?.error).toMatch(/why/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's 'bookings have changed' sentence and hides raw errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Bookings have changed: 3 appointment(s) now fall in this leave. Look again before approving." } });
    expect((await decideLeave(undefined, form({ requestId: REQ, decision: "approved", expectedCancellations: "2" })))?.error).toMatch(/Bookings have changed/);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internal" } });
    expect((await cancelLeave(undefined, form({ requestId: REQ })))?.error).toBe("Something went wrong. Please try again.");
  });
});
