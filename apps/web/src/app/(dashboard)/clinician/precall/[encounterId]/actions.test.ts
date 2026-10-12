const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { extendCall } from "./actions";

const ENC = "55555555-5555-4555-8555-555555555555";
function form(encounter: string, minutes: string): FormData {
  const f = new FormData();
  f.set("encounter_id", encounter);
  f.set("minutes", minutes);
  return f;
}

beforeEach(() => rpc.mockReset());

describe("extendCall", () => {
  it("adds the minutes and reports the total", async () => {
    rpc.mockResolvedValue({ data: { planned_minutes: 15, extended_minutes: 10, calendar_conflict: false }, error: null });
    const r = await extendCall(undefined, form(ENC, "10"));
    expect(rpc).toHaveBeenCalledWith("extend_encounter_call", { p_encounter: ENC, p_extra_minutes: 10 });
    expect(r?.message).toBe("Added. Total added: 10 minutes.");
  });

  it("warns, but does not fail, when the next booking starts straight after", async () => {
    rpc.mockResolvedValue({ data: { planned_minutes: 15, extended_minutes: 5, calendar_conflict: true }, error: null });
    const r = await extendCall(undefined, form(ENC, "5"));
    expect(r?.message).toMatch(/check your calendar/);
    expect(r?.error).toBeUndefined();
  });

  it("refuses odd amounts and bad ids before calling the database", async () => {
    expect((await extendCall(undefined, form(ENC, "3")))?.error).toBeDefined();
    expect((await extendCall(undefined, form(ENC, "30")))?.error).toBeDefined();
    expect((await extendCall(undefined, form(ENC, "7.5")))?.error).toBeDefined();
    expect((await extendCall(undefined, form("nope", "5")))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's cap message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "a call can be extended by at most 15 minutes in total" } });
    expect((await extendCall(undefined, form(ENC, "10")))?.error).toBe("a call can be extended by at most 15 minutes in total");
  });
});
