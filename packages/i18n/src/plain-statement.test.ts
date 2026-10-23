import { describe, expect, it } from "@jest/globals";
import { en } from "./en";
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
    expect(JSON.stringify(s.pricing.priceLine)).not.toMatch(/₦/);
  });

  it("uses an in-app fallback that does not send the reader in a circle", () => {
    const app = plainStatement({ price: null, refundDays: null, surface: "app" });
    expect(app.pricing.priceLine).toBe("See the Membership screen for the price before you pay.");
  });

  it("describes the Membership offer from the same catalogue keys the pricing page uses (drift guard)", () => {
    const s = plainStatement({ price: "1", refundDays: 1 });
    expect(s.pricing.offerDescription).toBe(en["catalog.membership_annual.description"]);
    expect(s.pricing.offerIncludes).toEqual([
      en["catalog.membership_annual.incl.1"],
      en["catalog.membership_annual.incl.2"],
      en["catalog.membership_annual.incl.3"],
      en["catalog.membership_annual.incl.4"],
    ]);
  });

  it("has privacy first and no banned wording", () => {
    const s = plainStatement({ price: "1", refundDays: 1 });
    expect(s.privacy.points.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toMatch(/—|your doctor|doctor-led|\bAI\b|% off/i);
  });

  it("says no more about deletion, analytics, ads and checks than the real flows and cookies page say", () => {
    const text = JSON.stringify(plainStatement({ price: "1", refundDays: 1 }));
    expect(text).not.toMatch(/still to be confirmed|retention period/i);
    expect(text).not.toMatch(/on our public website/i);
    expect(text).not.toMatch(/does not read your phone/i);
    expect(text).not.toMatch(/every page/i);
    expect(text).toMatch(/while you are signed in/);
    expect(text).toMatch(/linked to your account/);
    expect(text).toMatch(/person on our team reviews/);
    expect(text).toMatch(/advertising ID permission/);
  });
});
