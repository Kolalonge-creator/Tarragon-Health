/**
 * Naira/kobo conversion at the staff-form submit boundary.
 *
 * The bug these guard against: a screen that reads amounts in naira but
 * collects them in kobo, so an operator looking at a ₦50,000 billed line
 * types 5000 and approves ₦50.
 */

import { formatKobo, nairaInputToKobo } from "./format-money";

describe("nairaInputToKobo", () => {
  it("sends kobo for the naira an operator typed", () => {
    // The worked example: ₦50,000 billed, operator types 50000.
    expect(nairaInputToKobo("50000")).toBe(5_000_000);
  });

  it("keeps kobo precision on a fractional amount", () => {
    expect(nairaInputToKobo("1234.56")).toBe(123_456);
    expect(nairaInputToKobo("0.01")).toBe(1);
  });

  it("rounds rather than truncating a sub-kobo amount", () => {
    expect(nairaInputToKobo("0.005")).toBe(1);
    expect(nairaInputToKobo("0.004")).toBe(0);
  });

  it("accepts an amount pasted from an invoice", () => {
    expect(nairaInputToKobo("₦50,000.00")).toBe(5_000_000);
    expect(nairaInputToKobo(" 50 000 ")).toBe(5_000_000);
  });

  it("returns null rather than a zero for a blank or bad value", () => {
    expect(nairaInputToKobo("")).toBeNull();
    expect(nairaInputToKobo("   ")).toBeNull();
    expect(nairaInputToKobo("abc")).toBeNull();
    expect(nairaInputToKobo("-100")).toBeNull();
    expect(nairaInputToKobo(null)).toBeNull();
    expect(nairaInputToKobo(undefined)).toBeNull();
  });

  it("treats zero as a real amount, not a missing one", () => {
    expect(nairaInputToKobo("0")).toBe(0);
  });
});

describe("formatKobo", () => {
  it("shows the amount the operator is confirming", () => {
    expect(formatKobo(5_000_000)).toBe("₦50,000.00");
  });

  it("keeps two decimals so a kobo difference stays visible", () => {
    expect(formatKobo(5_000_050)).toBe("₦50,000.50");
    expect(formatKobo(1)).toBe("₦0.01");
    expect(formatKobo(0)).toBe("₦0.00");
  });

  it("makes the 100x mistake obvious when read back", () => {
    // What the old screen did with "5000" typed against a ₦50,000 line.
    expect(formatKobo(5000)).toBe("₦50.00");
  });
});

describe("the two together", () => {
  it("round trips what the operator typed", () => {
    const kobo = nairaInputToKobo("50000");
    expect(kobo).toBe(5_000_000);
    expect(formatKobo(kobo as number)).toBe("₦50,000.00");
  });
});
