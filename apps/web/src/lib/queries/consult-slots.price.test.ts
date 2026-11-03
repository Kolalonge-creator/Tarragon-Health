import { parseVideoVisitPrice } from "./consult-slots";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));

describe("parseVideoVisitPrice", () => {
  it("passes the database's answer through", () => {
    expect(parseVideoVisitPrice({ amount_minor: 800000, currency: "NGN" })).toEqual({ amount_minor: 800000, currency: "NGN" });
  });

  it.each([
    ["null (no price, or switched off)", null],
    ["a string", "800000"],
    ["a missing amount", { currency: "NGN" }],
    ["a zero amount", { amount_minor: 0, currency: "NGN" }],
    ["a fractional amount", { amount_minor: 1.5, currency: "NGN" }],
    ["a missing currency", { amount_minor: 800000 }],
  ])("treats %s as no price rather than guessing a number", (_label, value) => {
    expect(parseVideoVisitPrice(value)).toBeNull();
  });
});
