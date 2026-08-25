import { reviewPriceDisplay } from "./review-price-display";
import type { ReviewPrice } from "@/lib/queries/review-price";

const priced = (over: Partial<ReviewPrice> = {}): ReviewPrice => ({
  ok: true,
  bundle_code: "screen_core",
  bundle_name: "Core Screen",
  currency: "NGN",
  total_kobo: 6_500_340,
  headline_price_kobo: 6_500_000,
  lines: [
    { code: "hba1c", name: "HbA1c" },
    { code: "fbc", name: "Full Blood Count" },
  ],
  priceable: true,
  ...over,
});

describe("reviewPriceDisplay", () => {
  it("says who the patient actually pays when Tarragon is not billing here", () => {
    expect(
      reviewPriceDisplay({ partnerBillingAvailable: false, isLoading: false, price: priced() })
    ).toEqual({ kind: "pay_the_lab" });
  });

  it("does not quote a price while it is still unknown whether Tarragon bills here", () => {
    // The dangerous case: a fully-formed, perfectly valid price is available,
    // and it still must not be shown, because nothing has established that
    // this patient is in a state where Tarragon collects the money.
    expect(
      reviewPriceDisplay({ partnerBillingAvailable: undefined, isLoading: false, price: priced() })
    ).toEqual({ kind: "pay_the_lab" });
  });

  it("shows the one computed number once billing is live", () => {
    expect(
      reviewPriceDisplay({ partnerBillingAvailable: true, isLoading: false, price: priced() })
    ).toEqual({
      kind: "price",
      totalKobo: 6_500_340,
      testCount: 2,
      lines: [
        { code: "hba1c", name: "HbA1c" },
        { code: "fbc", name: "Full Blood Count" },
      ],
    });
  });

  it("promises nothing when the review is not priceable", () => {
    // What the database returns for a review containing nothing for this
    // patient, or one containing a test with no price on file.
    expect(
      reviewPriceDisplay({
        partnerBillingAvailable: true,
        isLoading: false,
        price: priced({ priceable: false }),
      })
    ).toEqual({ kind: "confirm_later" });
  });

  it("treats a zero total as broken rather than free", () => {
    expect(
      reviewPriceDisplay({
        partnerBillingAvailable: true,
        isLoading: false,
        price: priced({ total_kobo: 0 }),
      })
    ).toEqual({ kind: "confirm_later" });
  });

  it("waits rather than guessing while the price is loading", () => {
    expect(
      reviewPriceDisplay({ partnerBillingAvailable: true, isLoading: true, price: null })
    ).toEqual({ kind: "loading" });
  });
});
