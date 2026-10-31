/**
 * Naira/kobo conversion at the staff-form submit boundary.
 *
 * The bug these guard against: a screen that reads amounts in naira but
 * collects them in kobo, so an operator looking at a ₦50,000 billed line
 * types 5000 and approves ₦50.
 */

import { formatKobo } from "./format-money";

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
