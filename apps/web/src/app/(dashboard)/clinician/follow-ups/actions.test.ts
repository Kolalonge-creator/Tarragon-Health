const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { acknowledgeFollowUp, closeFollowUp } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => rpc.mockReset());

describe("closeFollowUp", () => {
  it("closes with an outcome and a reason", async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(closeFollowUp(undefined, form({ id, outcome: "done", reason: "Patient attended the lab" }))).resolves.toEqual({ message: "closed" });
    expect(rpc).toHaveBeenCalledWith("close_clinical_follow_up", { p_id: id, p_outcome: "done", p_reason: "Patient attended the lab" });
  });

  it("refuses a missing outcome, an unknown outcome and a short reason before calling the database", async () => {
    for (const bad of [{ id, outcome: "", reason: "long enough reason" }, { id, outcome: "closed", reason: "long enough reason" }, { id, outcome: "done", reason: "short" }, { id: "x", outcome: "done", reason: "long enough reason" }]) {
      const r = await closeFollowUp(undefined, form(bad));
      expect(r?.error).toBeTruthy();
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a refusal from the database", async () => {
    rpc.mockResolvedValue({ error: { message: "follow-up not found", code: "42501" } });
    const r = await closeFollowUp(undefined, form({ id, outcome: "other", reason: "long enough reason" }));
    expect(r?.error).toMatch(/do not have access/);
  });
});

describe("acknowledgeFollowUp", () => {
  it("acknowledges, and refuses a bad id", async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(acknowledgeFollowUp(undefined, form({ id }))).resolves.toEqual({ message: "acknowledged" });
    expect((await acknowledgeFollowUp(undefined, form({ id: "bad" })))?.error).toBeTruthy();
    rpc.mockResolvedValue({ error: { message: "boom" } });
    expect((await acknowledgeFollowUp(undefined, form({ id })))?.error).toMatch(/could not be saved/);
  });
});
