import { defaultWindow, formatCost, noticeForError, priceFormSchema } from "./model";

describe("formatCost", () => {
  it("says No price for null, never zero", () => {
    expect(formatCost(null, "USD")).toBe("No price");
    expect(formatCost(5_000_000, null)).toBe("No price");
  });
  it("converts millionths of a minor unit to major units by integer arithmetic", () => {
    // 1,050,000 millionths of a cent = 1.05 cents = 0.0105 USD
    expect(formatCost(1_050_000, "USD")).toBe("0.0105 USD");
    expect(formatCost(23_250_000, "USD")).toBe("0.2325 USD");
    expect(formatCost(100_000_000, "USD")).toBe("1.0000 USD");
    expect(formatCost(0, "USD")).toBe("0.0000 USD");
  });
});

describe("price form", () => {
  const ok = { model: "m", input: "300", output: "1500", currency: "usd", valid_from: "2026-01-01", source_note: "vendor price page read" };
  it("accepts integers and upper-cases the currency", () => {
    const r = priceFormSchema.safeParse(ok);
    expect(r.success && r.data.currency).toBe("USD");
  });
  it("rejects a decimal price, a bad currency and a short source note", () => {
    expect(priceFormSchema.safeParse({ ...ok, input: "3.5" }).success).toBe(false);
    expect(priceFormSchema.safeParse({ ...ok, currency: "US" }).success).toBe(false);
    expect(priceFormSchema.safeParse({ ...ok, source_note: "short" }).success).toBe(false);
  });
});

it("maps database errors to fixed notices", () => {
  expect(noticeForError("42501")).toBe("denied");
  expect(noticeForError("23505")).toBe("duplicate");
  expect(noticeForError("22023")).toBe("bad_input");
  expect(noticeForError(undefined)).toBe("failed");
});

it("default window spans 31 days ending tomorrow", () => {
  const w = defaultWindow(new Date("2026-10-07T10:00:00Z"));
  expect(w).toEqual({ from: "2026-09-07", to: "2026-10-08" });
});
