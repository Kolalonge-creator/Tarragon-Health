const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { setItemActive, setItemPrice } from "./actions";

const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
beforeEach(() => rpc.mockReset());

describe("setItemActive", () => {
  it("refuses a short reason without calling the database", async () => {
    const r = await setItemActive(undefined, form({ code: "membership_annual", active: "true", reason: "short" }));
    expect(r?.error).toMatch(/reason/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a bad code or flag", async () => {
    expect((await setItemActive(undefined, form({ code: "Bad Code", active: "true", reason: "A proper reason here" })))?.error).toBeDefined();
    expect((await setItemActive(undefined, form({ code: "membership_annual", active: "maybe", reason: "A proper reason here" })))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("switches an item on and says so", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await setItemActive(undefined, form({ code: "membership_annual", active: "true", reason: "Founder approved the launch" }));
    expect(r?.message).toBe("Item switched on.");
    expect(rpc).toHaveBeenCalledWith("set_catalog_item_active", { p_code: "membership_annual", p_active: true, p_reason: "Founder approved the launch" });
  });
  it("maps the database's refusals to sentences", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "item_has_no_price" } });
    expect((await setItemActive(undefined, form({ code: "membership_annual", active: "true", reason: "A proper reason here" })))?.error).toMatch(/no price/);
    rpc.mockResolvedValue({ data: null, error: { message: "catalogue_not_authorised" } });
    expect((await setItemActive(undefined, form({ code: "membership_annual", active: "false", reason: "A proper reason here" })))?.error).toMatch(/admin/);
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await setItemActive(undefined, form({ code: "membership_annual", active: "false", reason: "A proper reason here" })))?.error).toMatch(/did not save/);
  });
});

describe("setItemPrice", () => {
  const base = { code: "membership_annual", naira: "100000", starts_on: "2026-11-01", reason: "Founder confirmed price" };
  it("converts whole naira to integer kobo exactly and starts at the start of that day in Lagos", async () => {
    rpc.mockResolvedValue({ data: "p1", error: null });
    const r = await setItemPrice(undefined, form(base));
    expect(r?.message).toBe("Price saved.");
    expect(rpc).toHaveBeenCalledWith("set_item_price", {
      p_code: "membership_annual", p_amount_kobo: 10_000_000, p_components: {}, p_reason: "Founder confirmed price", p_valid_from: "2026-10-31T23:00:00.000Z",
    });
  });
  it("refuses fractions, zero, letters, a missing date and a short reason", async () => {
    for (const over of [{ naira: "100.5" }, { naira: "0" }, { naira: "abc" }, { naira: "" }, { starts_on: "" }, { starts_on: "2026-13-45x" }, { reason: "short" }]) {
      expect((await setItemPrice(undefined, form({ ...base, ...over })))?.error).toBeDefined();
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps a backdated price to a sentence", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "price_start_before_current" } });
    expect((await setItemPrice(undefined, form(base)))?.error).toMatch(/after the current price/);
  });
});
