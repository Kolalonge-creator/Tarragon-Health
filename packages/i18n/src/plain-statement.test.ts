import { describe, expect, it } from "@jest/globals";
import { en } from "./en";
import { plainStatement } from "./plain-statement";

describe("plain pricing and accessibility statement", () => {
  it("quotes the price and refund window it is given, and nothing else", () => {
    const s = plainStatement({ price: "100", refundDays: 7 });
    expect(s.pricing.offers[0].priceLine).toBe("Tarragon Membership costs ₦100 a year.");
    expect(s.pricing.refundLine).toContain("7 days");
  });

  it("shows no number at all when the price cannot be read", () => {
    const s = plainStatement({ price: null, refundDays: 7 });
    expect(s.pricing.offers[0].priceLine).toBe("See the price in the app before you pay.");
    expect(s.pricing.refundLine).toBeNull();
    expect(s.pricing.offers[0].priceLine).not.toMatch(/₦/);
  });

  it("uses an in-app fallback that does not send the reader in a circle", () => {
    const app = plainStatement({ price: null, refundDays: null, surface: "app" });
    expect(app.pricing.offers[0].priceLine).toBe("See the Membership screen for the price before you pay.");
  });

  it("ladder off: one offer, described from the same catalogue keys the pricing page uses (drift guard)", () => {
    const s = plainStatement({ price: "1", refundDays: 1 });
    expect(s.pricing.offers).toHaveLength(1);
    expect(s.pricing.difference).toBeNull();
    expect(s.pricing.offers[0].description).toBe(en["catalog.membership_annual.description"]);
    expect(s.pricing.offers[0].includes).toEqual([
      en["catalog.membership_annual.incl.1"],
      en["catalog.membership_annual.incl.2"],
      en["catalog.membership_annual.incl.3"],
      en["catalog.membership_annual.incl.4"],
    ]);
  });

  it("ladder on: Membership and Membership Plus, each with its own price and catalogue text, the blood panel the one difference", () => {
    const s = plainStatement({ price: "1", refundDays: 1, ladder: { membership: "84,000", plus: "129,000" } });
    expect(s.pricing.offers.map((o) => o.name)).toEqual(["Membership", "Membership Plus"]);
    expect(s.pricing.offers[0].priceLine).toBe("Membership costs ₦84,000 a year.");
    expect(s.pricing.offers[1].priceLine).toBe("Membership Plus costs ₦129,000 a year.");
    expect(s.pricing.offers[0].description).toBe(en["catalog.membership_annual_no_panel.description"]);
    expect(s.pricing.offers[0].includes).toHaveLength(3);
    expect(s.pricing.offers[1].description).toBe(en["catalog.membership_annual.description"]);
    expect(s.pricing.offers[1].includes).toHaveLength(4);
    expect(s.pricing.offers[0].includes.join(" ")).not.toMatch(/blood test/i);
    expect(s.pricing.offers[1].includes.join(" ")).toMatch(/blood test/i);
    expect(s.pricing.difference).toMatch(/only difference is the yearly blood panel/);
  });

  it("ladder on with one unreadable price: that offer shows the fallback, not a number", () => {
    const s = plainStatement({ price: null, refundDays: 1, surface: "app", ladder: { membership: "84,000", plus: null } });
    expect(s.pricing.offers[1].priceLine).toBe("See the Membership screen for the price before you pay.");
    expect(s.pricing.offers[0].priceLine).toContain("₦84,000");
  });

  it("uses the surface's renewal sentence when given and adds no second refund line; with none it makes no renewal claim", () => {
    const withLine = plainStatement({ price: "1", refundDays: 7, renewalLine: "Lasts a year." });
    expect(withLine.pricing.renewalLine).toBe("Lasts a year.");
    expect(withLine.pricing.refundLine).toBeNull();
    const without = plainStatement({ price: "1", refundDays: 7 });
    expect(without.pricing.renewalLine).toBeNull();
    expect(JSON.stringify({ ...without, pricing: { ...without.pricing, renewalLine: undefined } })).not.toMatch(/renew/i);
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
