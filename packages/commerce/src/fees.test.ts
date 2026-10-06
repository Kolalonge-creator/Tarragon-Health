import { describe, expect, it } from "@jest/globals";
import { estimatedBreakdown, estimateProcessingFeeKobo, formatNaira, recordedBreakdown, type FeeEstimateSchedule } from "../../../supabase/functions/_shared/commerce/fees.ts";

const S: FeeEstimateSchedule = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };

describe("estimateProcessingFeeKobo", () => {
  it("adds the flat part at or above the waiver line", () => {
    expect(estimateProcessingFeeKobo(250_000, S)).toBe(3_750 + 10_000);
  });
  it("waives the flat part below the line", () => {
    expect(estimateProcessingFeeKobo(100_000, S)).toBe(1_500);
  });
  it("rounds the percentage up to a whole kobo", () => {
    expect(estimateProcessingFeeKobo(100_001, S)).toBe(1_501);
  });
  it("never exceeds the cap", () => {
    expect(estimateProcessingFeeKobo(100_000_000, S)).toBe(200_000);
  });
  it("is zero for a zero, negative, fractional or unsafe price", () => {
    for (const p of [0, -5, 10.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) expect(estimateProcessingFeeKobo(p, S)).toBe(0);
  });
});

describe("breakdowns", () => {
  it("an estimate is labelled as one and adds up", () => {
    const b = estimatedBreakdown(10_000_000, S);
    expect(b).toEqual({ priceKobo: 10_000_000, feeKobo: 160_000, totalKobo: 10_160_000, estimated: true });
  });
  it("a recorded breakdown is exact", () => {
    expect(recordedBreakdown({ amount_kobo: 500_000, fee_kobo: 150, total_kobo: 500_150 })).toEqual({ priceKobo: 500_000, feeKobo: 150, totalKobo: 500_150, estimated: false });
  });
  it("is null when the fee is unknown or the figures do not add up", () => {
    expect(recordedBreakdown({ amount_kobo: 500_000, fee_kobo: null, total_kobo: null })).toBeNull();
    expect(recordedBreakdown({ amount_kobo: 500_000, fee_kobo: 150, total_kobo: 500_000 })).toBeNull();
    expect(recordedBreakdown({ amount_kobo: 500_000, fee_kobo: -1, total_kobo: 499_999 })).toBeNull();
  });
});

describe("formatNaira", () => {
  it("formats whole and part naira", () => {
    expect(formatNaira(10_000_000)).toBe("100,000");
    expect(formatNaira(1_200_000)).toBe("12,000");
    expect(formatNaira(1_205_050)).toBe("12,050.50");
    expect(formatNaira(5)).toBe("0.05");
  });
});
