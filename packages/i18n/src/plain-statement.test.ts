import { describe, expect, it } from "@jest/globals";
import { plainStatement } from "./plain-statement";

describe("plain pricing and accessibility statement", () => {
  it("quotes the price and refund window it is given, and nothing else", () => {
    const s = plainStatement({ price: "100", refundDays: 7 });
    expect(s.pricing.priceLine).toBe("Membership costs ₦100 a year.");
    expect(s.pricing.refundLine).toContain("7 days");
  });

  it("shows no number at all when the price cannot be read", () => {
    const s = plainStatement({ price: null, refundDays: 7 });
    expect(s.pricing.priceLine).toBe("See the price in the app before you pay.");
    expect(s.pricing.refundLine).toBeNull();
    expect(JSON.stringify(s.pricing)).not.toMatch(/₦/);
  });

  it("has privacy first and no banned wording", () => {
    const s = plainStatement({ price: "1", refundDays: 1 });
    expect(s.privacy.points.length).toBeGreaterThan(0);
    const all = JSON.stringify(s);
    expect(all).not.toMatch(/—|your doctor|doctor-led|\bAI\b|% off/i);
  });
});
