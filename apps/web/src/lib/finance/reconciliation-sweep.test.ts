import { toCurrencyCode, localStatusOf, type LocalTxnRow } from "./reconciliation-sweep";

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
