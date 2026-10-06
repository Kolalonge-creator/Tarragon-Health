/**
 * S24: the patient's yes and not-now. Input is validated, the RPC runs on the patient's own server client, every
 * outcome maps to plain words, and anything unreadable is never treated as applied.
 */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { confirmCareChange, declineCareChange } from "./care-change-actions";

const ID = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe("confirmCareChange", () => {
  it("calls the confirm RPC with the id and returns the applied outcome", async () => {
    rpc.mockResolvedValue({ data: { outcome: "applied" }, error: null });
    await expect(confirmCareChange({ changeId: ID })).resolves.toEqual({ ok: true, outcome: "applied" });
    expect(rpc).toHaveBeenCalledWith("confirm_care_plan_change", { p_change: ID });
    expect(revalidatePath).toHaveBeenCalledWith("/patient/medications");
  });

  it.each(["expired", "needs_review", "not_available"] as const)("passes %s through for the card to explain", async (outcome) => {
    rpc.mockResolvedValue({ data: { outcome }, error: null });
    await expect(confirmCareChange({ changeId: ID })).resolves.toEqual({ ok: true, outcome });
  });

  it("refuses an invalid id without calling the database", async () => {
    for (const bad of [undefined, null, {}, { changeId: "nope" }, { changeId: 5 }, "x"]) {
      await expect(confirmCareChange(bad)).resolves.toEqual({ ok: false, key: "careChange.outcome.error" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an RPC error is a plain failure, never applied", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(confirmCareChange({ changeId: ID })).resolves.toEqual({ ok: false, key: "careChange.outcome.error" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("an unreadable reply is never treated as applied", async () => {
    rpc.mockResolvedValue({ data: { outcome: "applied-ish" }, error: null });
    await expect(confirmCareChange({ changeId: ID })).resolves.toEqual({ ok: false, key: "careChange.outcome.error" });
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(confirmCareChange({ changeId: ID })).resolves.toEqual({ ok: false, key: "careChange.outcome.error" });
  });
});

describe("declineCareChange", () => {
  it("calls the decline RPC and says the care team has been told", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(declineCareChange({ changeId: ID })).resolves.toEqual({ ok: true, key: "careChange.outcome.declined" });
    expect(rpc).toHaveBeenCalledWith("decline_care_plan_change", { p_change: ID });
    expect(revalidatePath).toHaveBeenCalledWith("/patient/medications");
  });

  it("passes a trimmed optional reason and refuses an over-long one", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await declineCareChange({ changeId: ID, reason: "  want to talk  " });
    expect(rpc).toHaveBeenCalledWith("decline_care_plan_change", { p_change: ID, p_reason: "want to talk" });
    rpc.mockClear();
    await expect(declineCareChange({ changeId: ID, reason: "x".repeat(501) })).resolves.toEqual({ ok: false, key: "careChange.outcome.error" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an invalid id and reports an RPC error plainly", async () => {
    await expect(declineCareChange({ changeId: "bad" })).resolves.toEqual({ ok: false, key: "careChange.outcome.error" });
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(declineCareChange({ changeId: ID })).resolves.toEqual({ ok: false, key: "careChange.outcome.error" });
  });
});
