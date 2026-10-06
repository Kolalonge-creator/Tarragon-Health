const rpc = jest.fn();
const profile = jest.fn();
const perm = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => profile() }));
jest.mock("@/lib/auth/permissions", () => ({ hasPermission: (k: string) => perm(k) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { approvePayoutAction, cancelPayoutAction, preparePayoutsAction } from "./actions";

const ID = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
  profile.mockResolvedValue({ role: "admin" });
  perm.mockResolvedValue(true);
});

describe("preparePayoutsAction", () => {
  it("sends someone without payouts.prepare away without calling the database", async () => {
    perm.mockResolvedValue(false);
    expect(await goes(preparePayoutsAction(fd({ start: "2026-09-28", end: "2026-10-04" })))).toBe("REDIRECT:/admin");
    expect(perm).toHaveBeenCalledWith("payouts.prepare");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the period and returns to the ops page", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(preparePayoutsAction(fd({ start: "2026-09-28", end: "2026-10-04" })))).toBe("REDIRECT:/admin/ops/payouts?n=prepared");
    expect(rpc).toHaveBeenCalledWith("prepare_payout_drafts", { p_period_start: "2026-09-28", p_period_end: "2026-10-04" });
  });
  it("a malformed period never reaches the database", async () => {
    expect(await goes(preparePayoutsAction(fd({ start: "x", end: "2026-10-04" })))).toBe("REDIRECT:/admin/ops/payouts?n=prepare_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a database refusal is a failure notice, not a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "payout_period_not_ended" } });
    expect(await goes(preparePayoutsAction(fd({ start: "2026-09-28", end: "2026-10-04" })))).toBe("REDIRECT:/admin/ops/payouts?n=prepare_failed");
  });
});

describe("approvePayoutAction", () => {
  const good = { payout: ID, note: "Checked the lines against the ledger" };
  it("never lets a non-admin reach the database, even one holding payouts.prepare", async () => {
    profile.mockResolvedValue({ role: "finance" });
    expect(await goes(approvePayoutAction(fd(good)))).toBe("REDIRECT:/admin");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("needs a note of 10 characters", async () => {
    expect(await goes(approvePayoutAction(fd({ ...good, note: "short" })))).toBe("REDIRECT:/admin/payouts?n=approve_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("approves with the note", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(approvePayoutAction(fd(good)))).toBe("REDIRECT:/admin/payouts?n=approved");
    expect(rpc).toHaveBeenCalledWith("approve_payout", { p_payout: ID, p_note: good.note });
  });
  it("the database's different-person refusal shows its own notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "payout_same_person", code: "42501" } });
    expect(await goes(approvePayoutAction(fd(good)))).toBe("REDIRECT:/admin/payouts?n=same_person");
  });
});

describe("cancelPayoutAction", () => {
  it("needs a reason and a real id", async () => {
    expect(await goes(cancelPayoutAction(fd({ payout: ID, viewer: "ops", reason: "no" })))).toBe("REDIRECT:/admin/ops/payouts?n=cancel_failed");
    expect(await goes(cancelPayoutAction(fd({ payout: "nope", viewer: "admin", reason: "a good enough reason" })))).toBe("REDIRECT:/admin/payouts?n=cancel_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns to the page the form came from, never to an address the form chose", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(cancelPayoutAction(fd({ payout: ID, viewer: "ops", reason: "withdrawn while checking" })))).toBe("REDIRECT:/admin/ops/payouts?n=cancelled");
    expect(await goes(cancelPayoutAction(fd({ payout: ID, viewer: "https://evil.example", reason: "withdrawn while checking" })))).toBe("REDIRECT:/admin/payouts?n=cancelled");
  });
  it("a refusal is a failure notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "payout_not_authorised" } });
    expect(await goes(cancelPayoutAction(fd({ payout: ID, viewer: "ops", reason: "withdrawn while checking" })))).toBe("REDIRECT:/admin/ops/payouts?n=cancel_failed");
  });
});
