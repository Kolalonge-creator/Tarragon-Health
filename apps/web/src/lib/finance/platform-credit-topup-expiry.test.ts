import { decideStaleTopup, type StaleTopupRow } from "./platform-credit-topup-expiry";

function row(overrides: Partial<StaleTopupRow> = {}): StaleTopupRow {
  return {
    id: "topup-1",
    organisation_id: "org-1",
    amount_kobo: 1000000,
    currency: "NGN",
    pending_payment_provider_ref: "ref-1",
    ...overrides,
  };
}

const NOT_ASKED = { asked: false, status: null, amountMinor: null };

describe("decideStaleTopup", () => {
  it("cancels a top-up that never reached the provider, since no charge can exist", () => {
    expect(decideStaleTopup(row({ pending_payment_provider_ref: null }), NOT_ASKED)).toEqual({
      kind: "cancel",
      reason: "Checkout was never started with the payment provider, so no charge can exist.",
    });
    expect(decideStaleTopup(row({ pending_payment_provider_ref: "   " }), NOT_ASKED)).toMatchObject({
      kind: "cancel",
    });
  });

  it("NEVER cancels a top-up the provider says was actually paid for", () => {
    // The whole reason this is a self-heal and not just a 24h expiry sweep:
    // cancelling a top-up somebody paid for would strand real money the
    // patient's balance was never credited with.
    expect(
      decideStaleTopup(row(), { asked: true, status: "success", amountMinor: 1000000 }),
    ).toEqual({ kind: "flag_paid", reference: "ref-1", providerAmountMinor: 1000000 });
  });

  it("cancels when the provider has a reference but no successful charge against it", () => {
    const abandoned = decideStaleTopup(row(), {
      asked: true,
      status: "abandoned",
      amountMinor: null,
    });
    expect(abandoned.kind).toBe("cancel");
    expect(abandoned.kind === "cancel" && abandoned.reason).toContain("abandoned");
  });

  it("does nothing at all when the provider could not be asked", () => {
    // An environment with no Paystack credentials must not infer that a
    // reference it cannot verify went unpaid.
    expect(decideStaleTopup(row(), NOT_ASKED)).toMatchObject({ kind: "skip" });
  });

  it("treats a reference the provider answered about but could not classify as unpaid, not paid", () => {
    expect(
      decideStaleTopup(row(), { asked: true, status: null, amountMinor: null }),
    ).toMatchObject({ kind: "cancel" });
    expect(
      decideStaleTopup(row(), { asked: true, status: "failed", amountMinor: null }),
    ).toMatchObject({ kind: "cancel" });
  });

  it("carries the provider's own amount onto the flag, even when it disagrees with ours", () => {
    const decision = decideStaleTopup(row({ amount_kobo: 1000000 }), {
      asked: true,
      status: "success",
      amountMinor: 100,
    });
    expect(decision).toEqual({ kind: "flag_paid", reference: "ref-1", providerAmountMinor: 100 });
  });
});
