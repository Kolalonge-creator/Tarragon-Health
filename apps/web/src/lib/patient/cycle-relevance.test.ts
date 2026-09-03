import { shouldOfferCycleTracking } from "./cycle-relevance";

describe("shouldOfferCycleTracking", () => {
  it("offers it to a patient recorded as female", () => {
    expect(shouldOfferCycleTracking("female")).toBe(true);
  });

  it("offers it when sex is unrecorded", () => {
    // The case that matters most: sex is not asked at signup, so most
    // accounts have no value. Under the previous `=== "female"` test the
    // tracker had no entry point at all for these patients.
    expect(shouldOfferCycleTracking(null)).toBe(true);
    expect(shouldOfferCycleTracking(undefined)).toBe(true);
  });

  it("does not offer it to a patient recorded as male", () => {
    expect(shouldOfferCycleTracking("male")).toBe(false);
  });
});
