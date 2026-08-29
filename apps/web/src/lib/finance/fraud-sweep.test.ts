import {
  detectDuplicateTransactions,
  detectRapidVelocity,
  detectUnusualAmounts,
  median,
  isoWeekBucket,
  type NormalizedEvent,
} from "./fraud-sweep";

function event(overrides: Partial<NormalizedEvent> & Pick<NormalizedEvent, "id" | "occurredAt">): NormalizedEvent {
  return {
    source: "payment_transactions",
    organisationId: "org-1",
    patientId: "patient-1",
    groupKey: "sub:sub-1",
    amountMinor: 500000,
    currency: "NGN",
    paymentTransactionId: overrides.id,
    ...overrides,
  };
}

describe("median", () => {
  it("returns 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("returns the middle value for an odd-length list, unsorted input", () => {
    expect(median([30, 10, 20])).toBe(20);
  });
});

describe("isoWeekBucket", () => {
  it("buckets two dates in the same ISO week identically", () => {
    const monday = isoWeekBucket(new Date("2026-08-24T09:00:00Z"));
    const friday = isoWeekBucket(new Date("2026-08-28T21:00:00Z"));
    expect(monday).toBe(friday);
  });

  it("buckets dates a week apart differently", () => {
    const weekOne = isoWeekBucket(new Date("2026-08-24T09:00:00Z"));
    const weekTwo = isoWeekBucket(new Date("2026-08-31T09:00:00Z"));
    expect(weekOne).not.toBe(weekTwo);
  });
});

describe("detectDuplicateTransactions", () => {
  it("flags two same-amount charges against the same subscription within 30 minutes", () => {
    const events = [
      event({ id: "t1", occurredAt: "2026-08-29T10:00:00Z" }),
      event({ id: "t2", occurredAt: "2026-08-29T10:10:00Z" }),
    ];
    const signals = detectDuplicateTransactions(events);
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_type).toBe("duplicate_transaction");
    expect(signals[0].severity).toBe("high");
  });

  it("does not flag the same group/amount more than 30 minutes apart", () => {
    const events = [
      event({ id: "t1", occurredAt: "2026-08-29T10:00:00Z" }),
      event({ id: "t2", occurredAt: "2026-08-29T10:45:00Z" }),
    ];
    expect(detectDuplicateTransactions(events)).toHaveLength(0);
  });

  it("does not flag a single charge, or charges with different amounts", () => {
    const single = [event({ id: "t1", occurredAt: "2026-08-29T10:00:00Z" })];
    expect(detectDuplicateTransactions(single)).toHaveLength(0);

    const differentAmounts = [
      event({ id: "t1", occurredAt: "2026-08-29T10:00:00Z", amountMinor: 500000 }),
      event({ id: "t2", occurredAt: "2026-08-29T10:05:00Z", amountMinor: 600000 }),
    ];
    expect(detectDuplicateTransactions(differentAmounts)).toHaveLength(0);
  });

  it("never flags video_visit_request or care_voucher_payment events — each row is already 1:1 with its own booking/instalment", () => {
    const events = [
      event({ id: "v1", occurredAt: "2026-08-29T10:00:00Z", source: "video_visit_request", groupKey: "video:v1" }),
      event({ id: "v2", occurredAt: "2026-08-29T10:05:00Z", source: "video_visit_request", groupKey: "video:v1" }),
    ];
    expect(detectDuplicateTransactions(events)).toHaveLength(0);
  });

  it("ignores events with no resolvable group key", () => {
    const events = [
      event({ id: "t1", occurredAt: "2026-08-29T10:00:00Z", groupKey: null }),
      event({ id: "t2", occurredAt: "2026-08-29T10:05:00Z", groupKey: null }),
    ];
    expect(detectDuplicateTransactions(events)).toHaveLength(0);
  });
});

describe("detectRapidVelocity", () => {
  it("flags a patient with 5+ payments inside an hour", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      event({ id: `t${i}`, occurredAt: new Date(Date.parse("2026-08-29T10:00:00Z") + i * 600_000).toISOString() }),
    );
    const signals = detectRapidVelocity(events);
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_type).toBe("rapid_velocity");
    expect(signals[0].patient_id).toBe("patient-1");
  });

  it("does not flag fewer than 5 payments in an hour", () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      event({ id: `t${i}`, occurredAt: new Date(Date.parse("2026-08-29T10:00:00Z") + i * 600_000).toISOString() }),
    );
    expect(detectRapidVelocity(events)).toHaveLength(0);
  });

  it("does not flag 5 payments spread across more than an hour", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      event({ id: `t${i}`, occurredAt: new Date(Date.parse("2026-08-29T10:00:00Z") + i * 30 * 60_000).toISOString() }),
    );
    expect(detectRapidVelocity(events)).toHaveLength(0);
  });

  it("keeps different patients' events independent", () => {
    const patientA = Array.from({ length: 5 }, (_, i) =>
      event({ id: `a${i}`, occurredAt: new Date(Date.parse("2026-08-29T10:00:00Z") + i * 600_000).toISOString(), patientId: "patient-a" }),
    );
    const patientB = Array.from({ length: 2 }, (_, i) =>
      event({ id: `b${i}`, occurredAt: new Date(Date.parse("2026-08-29T10:00:00Z") + i * 600_000).toISOString(), patientId: "patient-b" }),
    );
    const signals = detectRapidVelocity([...patientA, ...patientB]);
    expect(signals).toHaveLength(1);
    expect(signals[0].patient_id).toBe("patient-a");
  });

  it("ignores events with no resolvable patient", () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      event({ id: `t${i}`, occurredAt: new Date(Date.parse("2026-08-29T10:00:00Z") + i * 600_000).toISOString(), patientId: null }),
    );
    expect(detectRapidVelocity(events)).toHaveLength(0);
  });
});

describe("detectUnusualAmounts", () => {
  it("flags a fresh charge well above the organisation's median and the floor", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      event({ id: `base${i}`, occurredAt: "2026-08-01T00:00:00Z", amountMinor: 500000 }),
    );
    const outlier = event({ id: "out1", occurredAt: "2026-08-29T00:00:00Z", amountMinor: 10_000_000 });
    const signals = detectUnusualAmounts([...baseline, outlier], "2026-08-28T00:00:00Z");
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_type).toBe("unusual_amount");
    expect(signals[0].severity).toBe("low");
  });

  it("does not flag an amount within normal range for the organisation", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      event({ id: `base${i}`, occurredAt: "2026-08-01T00:00:00Z", amountMinor: 500000 }),
    );
    const normal = event({ id: "n1", occurredAt: "2026-08-29T00:00:00Z", amountMinor: 600000 });
    expect(detectUnusualAmounts([...baseline, normal], "2026-08-28T00:00:00Z")).toHaveLength(0);
  });

  it("does not flag an old outlier outside the fresh window", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      event({ id: `base${i}`, occurredAt: "2026-08-01T00:00:00Z", amountMinor: 500000 }),
    );
    const staleOutlier = event({ id: "out1", occurredAt: "2026-08-05T00:00:00Z", amountMinor: 10_000_000 });
    expect(detectUnusualAmounts([...baseline, staleOutlier], "2026-08-28T00:00:00Z")).toHaveLength(0);
  });

  it("respects the absolute floor even when the org median is tiny", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      event({ id: `base${i}`, occurredAt: "2026-08-01T00:00:00Z", amountMinor: 1000 }),
    );
    // 5x median (5,000) is far under the floor, but the amount itself is
    // also under the floor, so this should NOT flag.
    const smallCharge = event({ id: "s1", occurredAt: "2026-08-29T00:00:00Z", amountMinor: 6000 });
    expect(detectUnusualAmounts([...baseline, smallCharge], "2026-08-28T00:00:00Z")).toHaveLength(0);
  });
});
