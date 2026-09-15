import {
  detectDuplicateTransactions,
  detectRapidVelocity,
  detectUnusualAmounts,
  detectRefundConcentration,
  type SweepPayment,
  type SweepRefund,
} from "./fraud-sweep";

function payment(overrides: Partial<SweepPayment>): SweepPayment {
  return {
    id: "txn-1",
    payer_profile_id: "patient-1",
    organisation_id: "org-1",
    amount_minor: 100000,
    currency: "NGN",
    provider: "paystack",
    event_type: "charge.success",
    processed_at: "2026-08-30T10:00:00Z",
    error: null,
    created_at: "2026-08-30T10:00:00Z",
    ...overrides,
  };
}

describe("detectDuplicateTransactions", () => {
  it("flags a second successful charge for the same payer/amount/currency within the window", () => {
    const signals = detectDuplicateTransactions([
      payment({ id: "a", created_at: "2026-08-30T10:00:00Z" }),
      payment({ id: "b", created_at: "2026-08-30T10:10:00Z" }),
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_type).toBe("duplicate_transaction");
    expect(signals[0].payment_transaction_id).toBe("b");
    expect(signals[0].dedupe_key).toBe("duplicate_transaction:a:b");
  });

  it("does not flag charges outside the time window", () => {
    const signals = detectDuplicateTransactions([
      payment({ id: "a", created_at: "2026-08-30T10:00:00Z" }),
      payment({ id: "b", created_at: "2026-08-30T11:00:00Z" }),
    ]);
    expect(signals).toHaveLength(0);
  });

  it("does not flag charges for different payers or different amounts", () => {
    const differentPayer = detectDuplicateTransactions([
      payment({ id: "a", payer_profile_id: "patient-1" }),
      payment({ id: "b", payer_profile_id: "patient-2", created_at: "2026-08-30T10:05:00Z" }),
    ]);
    expect(differentPayer).toHaveLength(0);

    const differentAmount = detectDuplicateTransactions([
      payment({ id: "a", amount_minor: 100000 }),
      payment({ id: "b", amount_minor: 200000, created_at: "2026-08-30T10:05:00Z" }),
    ]);
    expect(differentAmount).toHaveLength(0);
  });

  it("ignores failed or unprocessed payments entirely", () => {
    const signals = detectDuplicateTransactions([
      payment({ id: "a", processed_at: null }),
      payment({ id: "b", error: "declined", created_at: "2026-08-30T10:05:00Z" }),
    ]);
    expect(signals).toHaveLength(0);
  });
});

describe("detectRapidVelocity", () => {
  it("flags a payer with >= threshold attempts within the window", () => {
    const attempts = Array.from({ length: 5 }, (_, i) =>
      payment({ id: `t${i}`, created_at: `2026-08-30T10:0${i}:00Z` }),
    );
    const signals = detectRapidVelocity(attempts, 3600_000, 5);
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_type).toBe("rapid_velocity");
    expect((signals[0].detail as { attempt_count: number }).attempt_count).toBe(5);
  });

  it("does not flag a payer under the threshold", () => {
    const attempts = Array.from({ length: 4 }, (_, i) =>
      payment({ id: `t${i}`, created_at: `2026-08-30T10:0${i}:00Z` }),
    );
    expect(detectRapidVelocity(attempts, 3600_000, 5)).toHaveLength(0);
  });

  it("only counts failed attempts or successful money-in events, not arbitrary rows", () => {
    const attempts = Array.from({ length: 5 }, (_, i) =>
      payment({ id: `t${i}`, event_type: "invoice.create", error: null, created_at: `2026-08-30T10:0${i}:00Z` }),
    );
    expect(detectRapidVelocity(attempts, 3600_000, 5)).toHaveLength(0);
  });
});

describe("detectUnusualAmounts", () => {
  it("flags a charge far above the payer's own recent average", () => {
    const history = Array.from({ length: 3 }, (_, i) =>
      payment({ id: `h${i}`, amount_minor: 10000, created_at: `2026-08-2${i}T10:00:00Z` }),
    );
    const spike = payment({ id: "spike", amount_minor: 100000, created_at: "2026-08-30T10:00:00Z" });
    const signals = detectUnusualAmounts([...history, spike], 5, 3);
    expect(signals).toHaveLength(1);
    expect(signals[0].payment_transaction_id).toBe("spike");
  });

  it("does not flag without enough payment history to establish a baseline", () => {
    const history = Array.from({ length: 2 }, (_, i) =>
      payment({ id: `h${i}`, amount_minor: 10000, created_at: `2026-08-2${i}T10:00:00Z` }),
    );
    const spike = payment({ id: "spike", amount_minor: 100000, created_at: "2026-08-30T10:00:00Z" });
    expect(detectUnusualAmounts([...history, spike], 5, 3)).toHaveLength(0);
  });

  it("does not flag a charge within the normal multiple of the average", () => {
    const history = Array.from({ length: 3 }, (_, i) =>
      payment({ id: `h${i}`, amount_minor: 10000, created_at: `2026-08-2${i}T10:00:00Z` }),
    );
    const normal = payment({ id: "normal", amount_minor: 15000, created_at: "2026-08-30T10:00:00Z" });
    expect(detectUnusualAmounts([...history, normal], 5, 3)).toHaveLength(0);
  });
});

function refund(overrides: Partial<SweepRefund>): SweepRefund {
  return {
    id: "refund-1",
    amount_minor: 50000,
    currency: "NGN",
    created_at: "2026-08-30T10:00:00Z",
    voucher: { beneficiary_profile_id: "patient-1", organisation_id: "org-1" },
    ...overrides,
  };
}

describe("detectRefundConcentration", () => {
  it("flags a patient with >= threshold refunds within the window", () => {
    const refunds = Array.from({ length: 3 }, (_, i) =>
      refund({ id: `r${i}`, created_at: `2026-08-1${i}T10:00:00Z` }),
    );
    const signals = detectRefundConcentration(refunds, 30, 3);
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_type).toBe("refund_concentration");
    expect((signals[0].detail as { refund_count: number }).refund_count).toBe(3);
  });

  it("does not flag a patient under the threshold", () => {
    const refunds = Array.from({ length: 2 }, (_, i) =>
      refund({ id: `r${i}`, created_at: `2026-08-1${i}T10:00:00Z` }),
    );
    expect(detectRefundConcentration(refunds, 30, 3)).toHaveLength(0);
  });

  it("ignores refunds with no resolvable voucher/beneficiary", () => {
    const refunds = Array.from({ length: 3 }, (_, i) => refund({ id: `r${i}`, voucher: null }));
    expect(detectRefundConcentration(refunds, 30, 3)).toHaveLength(0);
  });

  it("does not flag refunds spread across a window wider than the threshold period", () => {
    const refunds = [
      refund({ id: "r0", created_at: "2026-01-01T10:00:00Z" }),
      refund({ id: "r1", created_at: "2026-04-01T10:00:00Z" }),
      refund({ id: "r2", created_at: "2026-08-30T10:00:00Z" }),
    ];
    expect(detectRefundConcentration(refunds, 30, 3)).toHaveLength(0);
  });
});
