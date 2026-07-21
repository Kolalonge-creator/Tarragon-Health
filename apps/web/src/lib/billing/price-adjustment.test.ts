import {
  computeAdjustedPriceMinor,
  planPriceAdjustment,
  type AdjustableRow,
} from "./price-adjustment";

function row(overrides: Partial<AdjustableRow> = {}): AdjustableRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    code: "essential",
    name: "Essential Care",
    currency: "NGN",
    price_minor: 800_000, // ₦8,000
    price_locked: false,
    is_active: true,
    active_subscriber_count: 0,
    ...overrides,
  };
}

describe("computeAdjustedPriceMinor", () => {
  it("applies the percent and rounds NGN to the nearest ₦500", () => {
    // ₦8,000 + 10% = ₦8,800 → rounds to ₦9,000
    expect(computeAdjustedPriceMinor(800_000, 10, "NGN")).toBe(900_000);
    // ₦15,000 + 10% = ₦16,500 → already on a ₦500 step
    expect(computeAdjustedPriceMinor(1_500_000, 10, "NGN")).toBe(1_650_000);
    // ₦25,000 + 16% = ₦29,000 → exact
    expect(computeAdjustedPriceMinor(2_500_000, 16, "NGN")).toBe(2_900_000);
  });

  it("rounds GBP/USD to the nearest whole unit", () => {
    // £25 + 10% = £27.50 → rounds to £28 (Math.round half-up)
    expect(computeAdjustedPriceMinor(2_500, 10, "GBP")).toBe(2_800);
    // $34 + 5% = $35.70 → $36
    expect(computeAdjustedPriceMinor(3_400, 5, "USD")).toBe(3_600);
  });

  it("supports decreases and never rounds a positive price to zero", () => {
    // ₦8,000 - 10% = ₦7,200 → ₦7,000
    expect(computeAdjustedPriceMinor(800_000, -10, "NGN")).toBe(700_000);
    // ₦300 - 49% would round to ₦0 → clamped to the ₦500 step
    expect(computeAdjustedPriceMinor(30_000, -49, "NGN")).toBe(50_000);
  });
});

describe("planPriceAdjustment", () => {
  const options = { percent: 10, includeInactive: false };

  it("adjusts a clean active row", () => {
    const [result] = planPriceAdjustment([row()], options);
    expect(result).toMatchObject({ status: "adjust", oldMinor: 800_000, newMinor: 900_000 });
  });

  it("never touches free rows", () => {
    const [result] = planPriceAdjustment([row({ price_minor: 0 })], options);
    expect(result.status).toBe("free");
  });

  it("reports price-locked rows for the clone flow instead of adjusting", () => {
    const [result] = planPriceAdjustment([row({ price_locked: true })], options);
    expect(result.status).toBe("locked");
    expect(result.newMinor).toBe(800_000);
  });

  it("treats rows with live subscribers as locked even without the lock flag", () => {
    // parentcare_usd is the real-world case: an active subscriber exists but
    // the lock trigger never fired (Stripe path) — must still be protected.
    const [result] = planPriceAdjustment([row({ active_subscriber_count: 1 })], options);
    expect(result.status).toBe("locked");
  });

  it("skips inactive rows unless includeInactive is set", () => {
    const inactive = row({ is_active: false });
    expect(planPriceAdjustment([inactive], options)[0].status).toBe("inactive_skipped");
    expect(
      planPriceAdjustment([inactive], { percent: 10, includeInactive: true })[0].status,
    ).toBe("adjust");
  });

  it("marks rows whose rounded price is unchanged", () => {
    // ₦500 + 1% = ₦505 → rounds back to ₦500
    const [result] = planPriceAdjustment([row({ price_minor: 50_000 })], {
      percent: 1,
      includeInactive: false,
    });
    expect(result.status).toBe("unchanged");
  });
});
