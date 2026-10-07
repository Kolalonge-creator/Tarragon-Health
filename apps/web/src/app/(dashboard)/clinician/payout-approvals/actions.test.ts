const rpc = jest.fn();
const staff = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: () => staff() }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: unknown) => s !== null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { approvePayoutAsCmo } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};

beforeEach(() => {
  rpc.mockReset();
  staff.mockResolvedValue({ doctor_tier: "chief_medical_officer" });
});

describe("approvePayoutAsCmo", () => {
  it("refuses a non-CMO before calling the database", async () => {
    staff.mockResolvedValue(null);
    const r = await approvePayoutAsCmo(undefined, fd({ payout_id: id }));
    expect(r?.error).toMatch(/do not have access/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a bad id before calling the database", async () => {
    expect((await approvePayoutAsCmo(undefined, fd({ payout_id: "nope" })))?.error).toMatch(/could not be found/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("calls approve_payout with the id and reports success", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const r = await approvePayoutAsCmo(undefined, fd({ payout_id: id }));
    expect(rpc).toHaveBeenCalledWith("approve_payout", { p_id: id });
    expect(r?.message).toMatch(/Approved/);
    expect(r?.error).toBeUndefined();
  });
  it("shows a failed RPC as a failure in plain words, never as approved", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "payout_self_approval" } });
    const r = await approvePayoutAsCmo(undefined, fd({ payout_id: id }));
    expect(r?.error).toMatch(/cannot be approved by the person it is for/);
    expect(r?.message).toBeUndefined();
    rpc.mockResolvedValue({ data: null, error: { message: "payout_guard_off" } });
    expect((await approvePayoutAsCmo(undefined, fd({ payout_id: id })))?.error).toMatch(/not switched on/);
  });
});
