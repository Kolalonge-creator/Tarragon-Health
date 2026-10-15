const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { askForLongerCall, pickSlot } from "./followup-actions";

const SLOT = "44444444-4444-4444-8444-444444444444";
const ENC = "55555555-5555-4555-8555-555555555555";

function form(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

beforeEach(() => rpc.mockReset());

describe("pickSlot", () => {
  it("books the chosen time and says when, in Lagos time", async () => {
    rpc.mockResolvedValue({ data: { status: "booked", appointment_id: SLOT, starts_at: "2026-10-13T08:30:00Z", minutes: 15, encounter_id: ENC }, error: null });
    const r = await pickSlot(undefined, form([["slot_id", SLOT]]));
    expect(rpc).toHaveBeenCalledWith("pick_followup_slot", { p_slot: SLOT, p_ask_longer: false });
    expect(r?.message).toBe("Booked for Tue 13 Oct, 09:30. See you then.");
  });

  it("passes on a request for a longer call", async () => {
    rpc.mockResolvedValue({ data: { status: "booked", starts_at: "2026-10-13T08:30:00Z" }, error: null });
    await pickSlot(undefined, form([["slot_id", SLOT], ["ask_longer", "on"]]));
    expect(rpc).toHaveBeenCalledWith("pick_followup_slot", { p_slot: SLOT, p_ask_longer: true });
  });

  it("treats a time that was just taken as a normal outcome and asks for another", async () => {
    rpc.mockResolvedValue({ data: { status: "unavailable" }, error: null });
    const r = await pickSlot(undefined, form([["slot_id", SLOT]]));
    expect(r?.error).toMatch(/just taken/);
    expect(r?.message).toBeUndefined();
  });

  it("tells the Member when the offer has run out or was withdrawn", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "expired" }, error: null });
    expect((await pickSlot(undefined, form([["slot_id", SLOT]])))?.error).toMatch(/run out/);
    rpc.mockResolvedValueOnce({ data: { status: "withdrawn" }, error: null });
    expect((await pickSlot(undefined, form([["slot_id", SLOT]])))?.error).toMatch(/run out/);
  });

  it("never says booked for a status that is not booked", async () => {
    rpc.mockResolvedValue({ data: { status: "picked" }, error: null });
    const r = await pickSlot(undefined, form([["slot_id", SLOT]]));
    expect(r?.message).toBeUndefined();
    expect(r?.error).toBeDefined();
  });

  it("refuses a bad id before calling the database", async () => {
    const r = await pickSlot(undefined, form([["slot_id", "nope"]]));
    expect(r?.error).toMatch(/could not book/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a plain database refusal and hides anything else", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "monthly check-ins are part of Membership" } });
    expect((await pickSlot(undefined, form([["slot_id", SLOT]])))?.error).toBe("monthly check-ins are part of Membership");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internals" } });
    expect((await pickSlot(undefined, form([["slot_id", SLOT]])))?.error).toMatch(/could not book/);
  });
});

describe("askForLongerCall", () => {
  it("asks for the consultation by id", async () => {
    rpc.mockResolvedValue({ data: { longer_requested: true }, error: null });
    const r = await askForLongerCall(undefined, form([["encounter_id", ENC]]));
    expect(rpc).toHaveBeenCalledWith("request_longer_call", { p_encounter: ENC });
    expect(r?.message).toMatch(/would like more time/);
  });
  it("refuses a bad id", async () => {
    expect((await askForLongerCall(undefined, form([["encounter_id", "x"]])))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
