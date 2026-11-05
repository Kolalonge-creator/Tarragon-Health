const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { createDiscountCode, setDiscountCodeStatus } from "./actions";

const form = (entries: Record<string, string | string[]>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
};
beforeEach(() => rpc.mockReset());

const base = { code: "WELCOME10", kind: "percent", percent: "10", max_total_uses: "100", max_per_person: "1", valid_from: "2026-11-03", valid_to: "2026-12-31" };

describe("createDiscountCode", () => {
  it("sends a percentage code with Lagos day boundaries and nothing it was not given", async () => {
    rpc.mockResolvedValue({ data: { id: "d1", code: "WELCOME10" }, error: null });
    const r = await createDiscountCode(undefined, form({ ...base, item: ["membership_annual_no_panel"] }));
    expect(r?.message).toBe("Code WELCOME10 created.");
    expect(rpc).toHaveBeenCalledWith("admin_create_discount_code", {
      p_code: "WELCOME10", p_kind: "percent", p_percent: 10, p_fixed_kobo: null, p_max_discount_kobo: null, p_item_codes: ["membership_annual_no_panel"],
      p_cohort_id: null, p_max_total_uses: 100, p_max_per_person: 1, p_valid_from: "2026-11-02T23:00:00.000Z", p_valid_to: "2026-12-31T22:59:59.000Z", p_note: null, p_badge: null,
    });
  });
  it("converts a fixed amount and its cap from whole naira to integer kobo exactly", async () => {
    rpc.mockResolvedValue({ data: { id: "d1", code: "FIVEK" }, error: null });
    await createDiscountCode(undefined, form({ ...base, code: "FIVEK", kind: "fixed", percent: "", naira: "5000", max_naira: "4000" }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_kind: "fixed", p_fixed_kobo: 500_000, p_max_discount_kobo: 400_000, p_percent: null });
  });
  it("a blank code asks the database to generate one", async () => {
    rpc.mockResolvedValue({ data: { id: "d1", code: "K7Q2M9" }, error: null });
    const r = await createDiscountCode(undefined, form({ ...base, code: "" }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_code: null });
    expect(r?.message).toBe("Code K7Q2M9 created.");
  });
  it("sends the founding member badge only when it is ticked", async () => {
    rpc.mockResolvedValue({ data: { id: "d1", code: "FOUNDING10" }, error: null });
    await createDiscountCode(undefined, form({ ...base, code: "FOUNDING10", badge: "founding_member", item: ["membership_annual_no_panel"] }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_badge: "founding_member", p_item_codes: ["membership_annual_no_panel"] });
  });
  it("refuses a badge it does not know without calling the database", async () => {
    const r = await createDiscountCode(undefined, form({ ...base, badge: "vip" }));
    expect(r?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("says plainly that a retired Plus item cannot be on a code (T2-13)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "retired_item" } });
    expect((await createDiscountCode(undefined, form({ ...base, item: ["membership_annual"] })))?.error).toMatch(/retired and no longer sold/);
  });
  it("says plainly when a founding code is already active", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "founding_offer_exists" } });
    expect((await createDiscountCode(undefined, form({ ...base, badge: "founding_member" })))?.error).toMatch(/already active/);
  });
  it("refuses bad input without calling the database", async () => {
    const cases: Record<string, string | string[]>[] = [
      { percent: "0" }, { percent: "101" }, { percent: "12.5" }, { code: "A-B" }, { code: "ab" },
      { kind: "fixed", naira: "0" }, { kind: "fixed", naira: "12.5" }, { valid_to: "2026-11-02" }, { valid_from: "" },
      { max_total_uses: "0" }, { max_per_person: "101" }, { item: ["Bad Item"] },
    ];
    for (const over of cases) {
      const r = await createDiscountCode(undefined, form({ ...base, ...over }));
      expect(r?.error).toBeDefined();
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps the database's refusals to sentences", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "discount_code_taken" } });
    expect((await createDiscountCode(undefined, form(base)))?.error).toMatch(/already in use/);
    rpc.mockResolvedValue({ data: null, error: { message: "pricing_not_authorised" } });
    expect((await createDiscountCode(undefined, form(base)))?.error).toMatch(/admin/);
    rpc.mockResolvedValue({ data: null, error: { message: "unknown_item" } });
    expect((await createDiscountCode(undefined, form(base)))?.error).toMatch(/catalogue/);
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await createDiscountCode(undefined, form(base)))?.error).toMatch(/did not save/);
  });
});

describe("setDiscountCodeStatus", () => {
  const id = "0b5f4a0e-5e7a-4f1c-9d2a-3c4b5a6d7e8f";
  it("refuses a short reason or a bad status without calling the database", async () => {
    expect((await setDiscountCodeStatus(undefined, form({ id, status: "paused", reason: "short" })))?.error).toMatch(/reason/);
    expect((await setDiscountCodeStatus(undefined, form({ id, status: "deleted", reason: "A proper reason here" })))?.error).toBeDefined();
    expect((await setDiscountCodeStatus(undefined, form({ id: "nope", status: "paused", reason: "A proper reason here" })))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("pauses, resumes and ends with the reason the database audits", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await setDiscountCodeStatus(undefined, form({ id, status: "paused", reason: "Campaign on hold this week" })))?.message).toBe("Code paused.");
    expect(rpc).toHaveBeenLastCalledWith("admin_set_discount_code_status", { p_id: id, p_status: "paused", p_reason: "Campaign on hold this week" });
    expect((await setDiscountCodeStatus(undefined, form({ id, status: "active", reason: "Campaign resumes today" })))?.message).toBe("Code is active again.");
    expect((await setDiscountCodeStatus(undefined, form({ id, status: "ended", reason: "Campaign is over for good" })))?.message).toBe("Code ended.");
  });
  it("maps the database's refusals to sentences", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "discount_code_invalid" } });
    expect((await setDiscountCodeStatus(undefined, form({ id, status: "paused", reason: "A proper reason here" })))?.error).toMatch(/not valid/);
  });
});
