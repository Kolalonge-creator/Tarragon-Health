import { rateDelta, buildChartSeries, buildComposition, buildKpis, compareDelta, isQuietPeriod, moneyOverviewSchema, recordHref, type MoneyOverview } from "./money-overview";
import { FINANCE_TERMS } from "./definitions";

function totals(over: Partial<MoneyOverview["current"]> = {}): MoneyOverview["current"] {
  return {
    from: "2026-11-01",
    to: "2026-11-07",
    gross_payment_volume_minor: 31650000,
    successful_payments: 4,
    refunds_minor: 3000000,
    refund_count: 1,
    net_collections_minor: 28650000,
    failed_payments: 1,
    success_rate: 0.8,
    customer_fees_minor: 150000,
    processing_errors: 1,
    recognised_revenue_minor: 400000,
    ...over,
  };
}

function overview(over: Partial<MoneyOverview> = {}): MoneyOverview {
  return {
    currency: "NGN",
    granularity: "day",
    generated_at: "2026-11-07T10:00:00Z",
    current: totals(),
    previous: totals({ gross_payment_volume_minor: 5000000, net_collections_minor: 5000000, refunds_minor: 0, refund_count: 0, successful_payments: 1, failed_payments: 0, success_rate: 1, recognised_revenue_minor: 0 }),
    active_paid_memberships: 3,
    active_paid_memberships_previous: 1,
    open_reconciliation_items: 2,
    series: [
      { bucket: "2026-11-01", gross_minor: 10150000, refunds_minor: 0, net_minor: 10150000, recognised_minor: 400000, successful_payments: 1, failed_payments: 0 },
      { bucket: "2026-11-02", gross_minor: 21500000, refunds_minor: 3000000, net_minor: 18500000, recognised_minor: 0, successful_payments: 3, failed_payments: 1 },
    ],
    composition: [
      { payer_type: "individual", amount_minor: 12650000, count: 2, previous_amount_minor: 5000000 },
      { payer_type: "family_sponsor", amount_minor: 10000000, count: 1, previous_amount_minor: 0 },
      { payer_type: "employer", amount_minor: 9000000, count: 1, previous_amount_minor: 0 },
    ],
    streams: [],
    providers: [],
    recent: [],
    ...over,
  };
}

describe("compareDelta", () => {
  it("says nothing without a comparison figure", () => {
    expect(compareDelta(10, null, true)).toBeUndefined();
    expect(compareDelta(10, undefined, true)).toBeUndefined();
    expect(compareDelta(null, 10, true)).toBeUndefined();
  });

  it("shows a real percentage and the arrow of the number", () => {
    expect(compareDelta(150, 100, true)).toEqual({ text: "↑ 50% on the comparison period", direction: "up" });
    expect(compareDelta(50, 100, true)).toEqual({ text: "↓ 50% on the comparison period", direction: "down" });
  });

  it("uses the caution tone when a bad figure rises, but keeps the up arrow", () => {
    expect(compareDelta(150, 100, false)).toEqual({ text: "↑ 50% on the comparison period", direction: "down" });
    expect(compareDelta(50, 100, false)?.direction).toBe("up");
  });

  it("never divides by zero", () => {
    expect(compareDelta(100, 0, true)).toEqual({ text: "↑ from none in the comparison period", direction: "up" });
    expect(compareDelta(0, 0, true)).toEqual({ text: "No change on the comparison period", direction: "flat" });
  });
});

describe("rateDelta", () => {
  it("describes a change in a rate in percentage points", () => {
    expect(rateDelta(0.8, 0.75)).toEqual({ text: "↑ 5 points on the comparison period", direction: "up" });
    expect(rateDelta(0.74, 0.75)).toEqual({ text: "↓ 1 point on the comparison period", direction: "down" });
    expect(rateDelta(0.8, null)).toBeUndefined();
  });
});

describe("buildKpis", () => {
  it("keeps gross volume, net collections, recognised revenue and refunds as separate figures", () => {
    const k = Object.fromEntries(buildKpis(overview()).map((t) => [t.key, t]));
    expect(k.gpv.value).toBe("₦316,500");
    expect(k.net.value).toBe("₦286,500");
    expect(k.recognised.value).toBe("₦4,000");
    expect(k.refunds.value).toBe("₦30,000");
    expect(new Set([k.gpv.term, k.net.term, k.recognised.term, k.refunds.term]).size).toBe(4);
  });

  it("every tile names a glossary entry that exists", () => {
    const keys = new Set(FINANCE_TERMS.map((t) => t.key));
    for (const tile of buildKpis(overview())) expect(keys.has(tile.term)).toBe(true);
  });

  it("shows no success rate rather than 0% when nothing was attempted", () => {
    const k = buildKpis(overview({ current: totals({ success_rate: null, successful_payments: 0, failed_payments: 0 }) }));
    const rate = k.find((t) => t.key === "success_rate");
    expect(rate?.value).toBe("No attempts");
    expect(rate?.delta).toBeUndefined();
  });

  it("drops every comparison line when no comparison period was asked for", () => {
    const k = buildKpis(overview({ previous: null, active_paid_memberships_previous: null }));
    expect(k.every((t) => t.delta === undefined)).toBe(true);
  });

  it("puts rising refunds in the caution tone", () => {
    const refunds = buildKpis(overview()).find((t) => t.key === "refunds");
    expect(refunds?.delta?.direction).toBe("down");
  });

  it("draws sparklines in naira from the series", () => {
    expect(buildKpis(overview()).find((t) => t.key === "gpv")?.spark).toEqual([101500, 215000]);
  });

  it("links no tile to a page that does not exist yet", () => {
    for (const tile of buildKpis(overview())) {
      if (tile.href) expect(["/finance/transactions", "/finance/revenue", "/finance/reconciliation", "/finance/refunds"]).toContain(tile.href);
    }
  });
});

describe("buildComposition", () => {
  it("shares add to 100 and the sponsor and employer rows stay apart", () => {
    const rows = buildComposition(overview());
    expect(rows.map((r) => r.payerType)).toEqual(["individual", "family_sponsor", "employer"]);
    expect(rows.reduce((s, r) => s + (r.share ?? 0), 0)).toBeCloseTo(100);
  });

  it("has no shares, not zero shares, when nothing was collected", () => {
    const rows = buildComposition(overview({ composition: [{ payer_type: "individual", amount_minor: 0, count: 0, previous_amount_minor: null }] }));
    expect(rows[0].share).toBeNull();
  });
});

describe("chart and quiet periods", () => {
  it("converts the series to naira with readable labels", () => {
    expect(buildChartSeries(overview())[1]).toMatchObject({ label: "2 Nov", gross: 215000, refunds: 30000, net: 185000 });
    expect(buildChartSeries(overview({ granularity: "month" }))[0].label).toBe("Nov 2026");
  });

  it("recognises a period with no money movement", () => {
    expect(isQuietPeriod(overview())).toBe(false);
    expect(isQuietPeriod(overview({ current: totals({ successful_payments: 0, refund_count: 0, failed_payments: 0, recognised_revenue_minor: 0 }) }))).toBe(true);
  });

  it("links every activity row to its transaction page", () => {
    expect(recordHref("order", "x")).toBe("/finance/transactions/order/x");
    expect(recordHref("voucher_refund", "x")).toBe("/finance/transactions/voucher_refund/x");
    expect(recordHref("unknown", "x")).toBeNull();
  });
});

describe("schema", () => {
  it("accepts the RPC shape and refuses a float amount", () => {
    expect(() => moneyOverviewSchema.parse(overview())).not.toThrow();
    const bad = overview({ current: totals({ gross_payment_volume_minor: 1.5 }) });
    expect(() => moneyOverviewSchema.parse(bad)).toThrow();
  });
});
