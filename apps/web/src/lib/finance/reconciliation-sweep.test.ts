import { toCurrencyCode, localStatusOf, localStripeAmount, type LocalTxnRow } from "./reconciliation-sweep";

function row(overrides: Partial<LocalTxnRow>): LocalTxnRow {
  return {
    id: "txn-1",
    organisation_id: "org-1",
    amount_minor: null,
    currency: null,
    processed_at: null,
    error: null,
    raw_payload: null,
    ...overrides,
  };
}

describe("toCurrencyCode", () => {
  it("accepts the three billed currencies, any case", () => {
    expect(toCurrencyCode("ngn")).toBe("NGN");
    expect(toCurrencyCode("GBP")).toBe("GBP");
    expect(toCurrencyCode("Usd")).toBe("USD");
  });

  it("rejects anything else, including null/undefined", () => {
    expect(toCurrencyCode("eur")).toBeNull();
    expect(toCurrencyCode(null)).toBeNull();
    expect(toCurrencyCode(undefined)).toBeNull();
    expect(toCurrencyCode("")).toBeNull();
  });
});

describe("localStatusOf", () => {
  it("is processed once processed_at is set and there is no error", () => {
    expect(localStatusOf(row({ processed_at: "2026-08-12T00:00:00Z" }))).toBe("processed");
  });

  it("is pending when neither error nor processed_at is set", () => {
    expect(localStatusOf(row({}))).toBe("pending");
  });

  it("reports the error even if processed_at was also set, since a webhook can fail partway through", () => {
    expect(localStatusOf(row({ processed_at: "2026-08-12T00:00:00Z", error: "no row with pending_provider_ref" })))
      .toBe("failed: no row with pending_provider_ref");
  });
});

describe("localStripeAmount", () => {
  it("trusts amount_minor/currency directly when the column is actually populated", () => {
    const result = localStripeAmount(row({ amount_minor: 150000, currency: "NGN" }));
    expect(result).toEqual({ amountMinor: 150000, currency: "NGN" });
  });

  it("recovers checkout.session.completed's amount_total from raw_payload when amount_minor is null", () => {
    const result = localStripeAmount(
      row({
        raw_payload: {
          type: "checkout.session.completed",
          data: { object: { amount_total: 500000, currency: "gbp" } },
        },
      }),
    );
    expect(result).toEqual({ amountMinor: 500000, currency: "GBP" });
  });

  it("recovers invoice.payment_succeeded's amount_paid from raw_payload", () => {
    const result = localStripeAmount(
      row({
        raw_payload: {
          type: "invoice.payment_succeeded",
          data: { object: { amount_paid: 999, currency: "usd" } },
        },
      }),
    );
    expect(result).toEqual({ amountMinor: 999, currency: "USD" });
  });

  it("returns nulls rather than throwing when raw_payload is missing or unrecognised", () => {
    expect(localStripeAmount(row({ raw_payload: null }))).toEqual({ amountMinor: null, currency: null });
    expect(localStripeAmount(row({ raw_payload: { type: "customer.subscription.created", data: { object: {} } } })))
      .toEqual({ amountMinor: null, currency: null });
  });
});
