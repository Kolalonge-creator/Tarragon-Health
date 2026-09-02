import { flatBreakdown, orderBreakdown } from "./price-breakdown";

describe("flatBreakdown", () => {
  it("produces a single line equal to the total, no discounts", () => {
    const b = flatBreakdown("Essential plan", 800000);
    expect(b.lines).toEqual([{ label: "Essential plan", amountKobo: 800000 }]);
    expect(b.discounts).toEqual([]);
    expect(b.totalKobo).toBe(800000);
    expect(b.currency).toBe("NGN");
  });

  it("accepts a non-NGN currency", () => {
    expect(flatBreakdown("Sponsor plan", 500, "USD").currency).toBe("USD");
  });
});

describe("orderBreakdown", () => {
  it("shows the catalogue price with no discount lines when nothing was applied", () => {
    const b = orderBreakdown({ label: "Lab tests", totalKobo: 2000000, payableKobo: 2000000 });
    expect(b.lines).toEqual([{ label: "Lab tests", amountKobo: 2000000 }]);
    expect(b.discounts).toEqual([]);
    expect(b.totalKobo).toBe(2000000);
  });

  it("collapses any gap between total and payable into one 'Discount applied' line", () => {
    const b = orderBreakdown({ label: "Lab tests", totalKobo: 2000000, payableKobo: 1600000 });
    expect(b.discounts).toEqual([{ label: "Discount applied", amountKobo: -400000 }]);
    expect(b.totalKobo).toBe(1600000);
  });

  it("omits the discount line entirely when total equals payable", () => {
    const b = orderBreakdown({ label: "Referral", totalKobo: 500000, payableKobo: 500000 });
    expect(b.discounts).toEqual([]);
  });

  it("defaults the VAT stub to exempt/zero, matching every real account today", () => {
    const b = flatBreakdown("Essential plan", 800000);
    expect(b.vat).toEqual({ treatment: "exempt", amountKobo: 0 });
  });
});
