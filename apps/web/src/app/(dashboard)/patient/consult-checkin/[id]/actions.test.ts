const rpc = jest.fn();
const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

import { submitCheckinAction } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u" } } });
});

describe("submitCheckinAction", () => {
  it("refuses malformed input before touching the database", async () => {
    expect(await submitCheckinAction({ checkinId: "nope", answers: {} })).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await submitCheckinAction({ checkinId: id, answers: { a: "b" } })).toEqual({ ok: false, reason: "signed_out" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the answers and an empty note as null, and returns the outcome", async () => {
    rpc.mockResolvedValue({ data: { red_flag: true, concern: true, follow_up: false, alert_raised: true }, error: null });
    const res = await submitCheckinAction({ checkinId: id, answers: { feeling: "worse" }, note: "   " });
    expect(rpc).toHaveBeenCalledWith("answer_post_consult_checkin", { p_id: id, p_answers: { feeling: "worse" }, p_free_text: null });
    expect(res).toEqual({ ok: true, outcome: { red_flag: true, concern: true, follow_up: false, alert_raised: true } });
  });

  it("maps a closed check-in to not_open and any other error to a code, never a database message", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret detail", code: "22023" } });
    expect(await submitCheckinAction({ checkinId: id, answers: { a: "b" } })).toEqual({ ok: false, reason: "not_open" });
    rpc.mockResolvedValue({ data: null, error: { message: "secret detail", code: "XX000" } });
    expect(await submitCheckinAction({ checkinId: id, answers: { a: "b" } })).toEqual({ ok: false, reason: "failed" });
  });

  it("treats a malformed outcome as a failure rather than a success", async () => {
    rpc.mockResolvedValue({ data: { weird: true }, error: null });
    expect(await submitCheckinAction({ checkinId: id, answers: { a: "b" } })).toEqual({ ok: false, reason: "failed" });
  });
});
