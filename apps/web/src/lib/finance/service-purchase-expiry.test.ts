import { decideStalePurchase, type StalePurchaseRow } from "./service-purchase-expiry";

function row(overrides: Partial<StalePurchaseRow> = {}): StalePurchaseRow {
  return {
    id: "sp-1",
    organisation_id: "org-1",
    amount_kobo: 350000,
    payable_kobo: 350000,
    currency: "NGN",
    pending_payment_provider_ref: "ref-1",
    ...overrides,
  };
}

const NOT_ASKED = { asked: false, status: null, amountMinor: null };

describe("decideStalePurchase", () => {
  it("cancels a checkout that never reached the provider, since no charge can exist", () => {
    // The shape all four live stranded rows are in: an intent was recorded
    // and /transaction/initialize either was never called or failed.
    expect(decideStalePurchase(row({ pending_payment_provider_ref: null }), NOT_ASKED)).toEqual({
      kind: "cancel",
      reason: "Checkout was never started with the payment provider, so no charge can exist.",
    });
    expect(decideStalePurchase(row({ pending_payment_provider_ref: "   " }), NOT_ASKED)).toMatchObject({
      kind: "cancel",
    });
  });

  it("NEVER cancels a purchase the provider says was actually paid for", () => {
    // The whole reason this is a self-heal and not just a 24h expiry sweep:
    // cancelling a purchase somebody paid for is the expensive mistake.
    expect(
      decideStalePurchase(row(), { asked: true, status: "success", amountMinor: 350000 }),
    ).toEqual({ kind: "flag_paid", reference: "ref-1", providerAmountMinor: 350000 });
  });

  it("cancels when the provider has a reference but no successful charge against it", () => {
    const abandoned = decideStalePurchase(row(), {
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
    expect(decideStalePurchase(row(), NOT_ASKED)).toMatchObject({ kind: "skip" });
  });

  it("treats a reference the provider answered about but could not classify as unpaid, not paid", () => {
    // Fails towards cancellation only for a status that is definitively not
    // 'success' — the patient can always retry, and a real payment would have
    // come back 'success'.
    expect(
      decideStalePurchase(row(), { asked: true, status: null, amountMinor: null }),
    ).toMatchObject({ kind: "cancel" });
    expect(
      decideStalePurchase(row(), { asked: true, status: "failed", amountMinor: null }),
    ).toMatchObject({ kind: "cancel" });
  });

  it("carries the provider's own amount onto the flag, even when it disagrees with ours", () => {
    // A flag whose two amounts differ is exactly the thing a human needs to
    // see; the sweep must not normalise it away.
    const decision = decideStalePurchase(row({ payable_kobo: 350000 }), {
      asked: true,
      status: "success",
      amountMinor: 100,
    });
    expect(decision).toEqual({ kind: "flag_paid", reference: "ref-1", providerAmountMinor: 100 });
  });
});
