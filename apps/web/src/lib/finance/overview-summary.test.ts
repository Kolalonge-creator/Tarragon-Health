import {
  buildFinanceOverview,
  sectionState,
  type FinanceOverviewInputs,
  type QuerySlice,
} from "./overview-summary";
import {
  dashboardSummarySchema,
  kpiSummarySchema,
  revenueByFundingSourceSchema,
  riskFlagsSchema,
  type DashboardSummary,
  type KpiSummary,
  type RevenueByFundingSource,
  type RiskFlags,
} from "./schemas";

const DASHBOARD: DashboardSummary = {
  cash_ngn: 150000,
  deferred_revenue_ngn: 20000,
  care_voucher_liability_ngn: 5000,
  receivables_ngn: 7000,
  vat_payable_ngn: 1000,
  wht_payable_ngn: 500,
  revenue_ytd_ngn: 900000,
  revenue_mtd_ngn: 100000,
  expenses_ytd_ngn: 300000,
  unreconciled: { count: 3, by_currency: [] },
  revenue_by_currency: [{ currency: "NGN", recognised_minor: 900000 }],
  open_period: "2026-10",
  entries_count: 1234,
};

const KPIS: KpiSummary = {
  currency: "NGN",
  revenue_mtd_minor: 100000,
  gross_profit_mtd_minor: 60000,
  gross_margin_pct: 60,
  net_income_mtd_minor: 20000,
  net_margin_pct: 20,
  mom_revenue_growth_pct: 3.2,
  yoy_revenue_growth_pct: -1,
  dso_days: 12,
  cash_runway_months: 4,
  cash_minor: 150000,
  receivable_minor: 7000,
};

const FUNDING: RevenueByFundingSource = {
  currency: "NGN",
  period_start: "2026-10-01",
  period_end: "2026-10-30",
  cash_minor: 80000,
  promotional_minor: 20000,
  unclassified_minor: 0,
  total_minor: 100000,
};

const NO_FLAGS: RiskFlags = {
  pending_approvals_count: 0,
  aged_unreconciled_count: 0,
  reconciliation_flags_count: 0,
  fraud_signals_count: 0,
  ap_due_soon_count: 0,
  ap_overdue_count: 0,
  compliance_overdue_count: 0,
};

const loaded = <T,>(data: T): QuerySlice<T> => ({ data, isLoading: false, isError: false });
const loading = <T,>(): QuerySlice<T> => ({ data: undefined, isLoading: true, isError: false });
const failed = <T,>(): QuerySlice<T> => ({ data: undefined, isLoading: false, isError: true });
/** A background refresh failed after a good load: TanStack keeps the old data. */
const stale = <T,>(data: T): QuerySlice<T> => ({ data, isLoading: false, isError: true });

function inputs(overrides: Partial<FinanceOverviewInputs> = {}): FinanceOverviewInputs {
  return {
    dashboard: loaded(DASHBOARD),
    kpis: loaded(KPIS),
    funding: loaded(FUNDING),
    flags: loaded(NO_FLAGS),
    ...overrides,
  };
}

describe("the refusal contract this module relies on", () => {
  // finance_* RPCs answer a caller who is not finance with exactly `{}`. These
  // schemas have no defaults, so that must fail the parse and arrive here as an
  // error, not as a row of believable zeros.
  it.each([
    ["dashboard", dashboardSummarySchema],
    ["kpis", kpiSummarySchema],
    ["funding split", revenueByFundingSourceSchema],
    ["risk flags", riskFlagsSchema],
  ])("%s schema rejects the refusal answer {}", (_name, schema) => {
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe("sectionState", () => {
  it("separates loading, failed, stale and ready", () => {
    expect(sectionState(loading())).toBe("loading");
    expect(sectionState(failed())).toBe("failed");
    expect(sectionState(stale(DASHBOARD))).toBe("stale");
    expect(sectionState(loaded(DASHBOARD))).toBe("ready");
  });
});

describe("buildFinanceOverview: loaded", () => {
  it("shows the real figures", () => {
    const v = buildFinanceOverview(inputs());
    expect(v.dashboard.tiles.cash).toEqual({ value: "₦1,500" });
    expect(v.dashboard.tiles.revenueYtd).toEqual({ value: "₦9,000" });
    expect(v.dashboard.tiles.unreconciled).toEqual({ value: "3" });
    expect(v.dashboard.ledger).toEqual({
      openPeriod: "2026-10",
      entries: "1,234",
      revenueMtd: "₦1,000",
      expensesYtd: "₦3,000",
    });
    expect(v.funding.tiles.cash).toEqual({ value: "₦800" });
    expect(v.dashboard.revenueByCurrency).toEqual({
      status: "ready",
      rows: [{ currency: "NGN", amount: "₦9,000" }],
      message: "",
    });
  });

  it("shows a real zero as zero", () => {
    const v = buildFinanceOverview(
      inputs({ dashboard: loaded({ ...DASHBOARD, cash_ngn: 0, unreconciled: { count: 0, by_currency: [] } }) })
    );
    expect(v.dashboard.tiles.cash).toEqual({ value: "₦0" });
    expect(v.dashboard.tiles.unreconciled).toEqual({ value: "0" });
  });

  it("formats growth with a sign and the ratio units", () => {
    const t = buildFinanceOverview(inputs()).kpis.tiles;
    expect(t.grossMargin).toEqual({ value: "60%" });
    expect(t.momGrowth).toEqual({ value: "+3.2%" });
    expect(t.yoyGrowth).toEqual({ value: "-1%" });
    expect(t.dso).toEqual({ value: "12d" });
    expect(t.runway).toEqual({ value: "4 mo" });
  });

  it("says a metric the ledger has no value for is not enough data, not zero or a dash", () => {
    const v = buildFinanceOverview(
      inputs({ kpis: loaded({ ...KPIS, mom_revenue_growth_pct: null, cash_runway_months: null }) })
    );
    expect(v.kpis.tiles.momGrowth).toEqual({ empty: { hint: "Not enough data yet" } });
    expect(v.kpis.tiles.runway).toEqual({ empty: { hint: "Not enough data yet" } });
    expect(v.kpis.tiles.grossMargin).toEqual({ value: "60%" });
  });

  it("tells no revenue booked yet apart from revenue not loaded", () => {
    const none = buildFinanceOverview(
      inputs({ dashboard: loaded({ ...DASHBOARD, revenue_by_currency: [] }) })
    );
    expect(none.dashboard.revenueByCurrency.status).toBe("empty");
    const unknown = buildFinanceOverview(inputs({ dashboard: failed() }));
    expect(unknown.dashboard.revenueByCurrency.status).toBe("unknown");
    expect(unknown.dashboard.revenueByCurrency.message).toBe("Could not be loaded");
    const pending = buildFinanceOverview(inputs({ dashboard: loading() }));
    expect(pending.dashboard.revenueByCurrency.message).toBe("Loading…");
  });

  it("labels a revenue row with no currency instead of guessing one", () => {
    const v = buildFinanceOverview(
      inputs({ dashboard: loaded({ ...DASHBOARD, revenue_by_currency: [{ currency: null, recognised_minor: 100 }] }) })
    );
    expect(v.dashboard.revenueByCurrency.rows[0]?.currency).toBe("—");
  });
});

describe("buildFinanceOverview: flag order", () => {
  it("leads with the most urgent flag whatever order the counts arrive in", () => {
    const everything: RiskFlags = {
      pending_approvals_count: 4,
      aged_unreconciled_count: 3,
      reconciliation_flags_count: 2,
      fraud_signals_count: 1,
      ap_due_soon_count: 5,
      ap_overdue_count: 6,
      compliance_overdue_count: 7,
    };
    const v = buildFinanceOverview(inputs({ flags: loaded(everything) }));
    expect(v.flags.items.map((i) => i.key)).toEqual([
      "fraud_signals_count",
      "compliance_overdue_count",
      "aged_unreconciled_count",
      "reconciliation_flags_count",
      "ap_overdue_count",
      "pending_approvals_count",
      "ap_due_soon_count",
    ]);
  });

  it("puts a routine approval behind an overdue bill", () => {
    const v = buildFinanceOverview(
      inputs({ flags: loaded({ ...NO_FLAGS, pending_approvals_count: 9, ap_overdue_count: 1 }) })
    );
    expect(v.flags.items[0]?.key).toBe("ap_overdue_count");
  });
});

describe("buildFinanceOverview: still loading", () => {
  it("shows Loading, never ₦0", () => {
    const v = buildFinanceOverview(
      inputs({ dashboard: loading(), kpis: loading(), funding: loading(), flags: loading() })
    );
    expect(v.dashboard.tiles.cash).toEqual({ empty: { hint: "Loading…" } });
    expect(v.dashboard.tiles.unreconciled).toEqual({ empty: { hint: "Loading…" } });
    expect(v.funding.tiles.cash).toEqual({ empty: { hint: "Loading…" } });
    expect(v.kpis.tiles.grossMargin).toEqual({ empty: { hint: "Loading…" } });
    expect(v.dashboard.ledger.entries).toBe("Loading…");
    expect(v.flags.allClear).toBe(false);
  });
});

describe("buildFinanceOverview: failed", () => {
  it("shows Could not be loaded, never ₦0, on every section", () => {
    const v = buildFinanceOverview(
      inputs({ dashboard: failed(), kpis: failed(), funding: failed(), flags: failed() })
    );
    expect(v.dashboard.state).toBe("failed");
    expect(v.dashboard.tiles.cash).toEqual({ empty: { hint: "Could not be loaded" } });
    expect(v.dashboard.ledger.openPeriod).toBe("Could not be loaded");
    expect(v.funding.tiles.cash).toEqual({ empty: { hint: "Could not be loaded" } });
    expect(v.funding.tiles.promotional).toEqual({ empty: { hint: "Could not be loaded" } });
    expect(v.kpis.tiles.netMargin).toEqual({ empty: { hint: "Could not be loaded" } });
  });

  it("does not report all clear when the risk flags could not be read", () => {
    const v = buildFinanceOverview(inputs({ flags: failed() }));
    expect(v.flags.state).toBe("failed");
    expect(v.flags.allClear).toBe(false);
    expect(v.flags.items).toEqual([]);
  });

  it("fails each section on its own", () => {
    const v = buildFinanceOverview(inputs({ funding: failed() }));
    expect(v.funding.state).toBe("failed");
    expect(v.dashboard.state).toBe("ready");
    expect(v.dashboard.tiles.cash).toEqual({ value: "₦1,500" });
  });
});

describe("buildFinanceOverview: a refresh failed after a good load", () => {
  it("keeps the figures that were read and marks them stale", () => {
    const v = buildFinanceOverview(inputs({ dashboard: stale(DASHBOARD) }));
    expect(v.dashboard.state).toBe("stale");
    expect(v.dashboard.tiles.cash).toEqual({ value: "₦1,500" });
  });

  it("is not all clear on stale flags, even when they were empty", () => {
    const v = buildFinanceOverview(inputs({ flags: stale(NO_FLAGS) }));
    expect(v.flags.state).toBe("stale");
    expect(v.flags.allClear).toBe(false);
  });
});

describe("flags", () => {
  it("is all clear only when the flags were read and there are none", () => {
    const v = buildFinanceOverview(inputs());
    expect(v.flags.allClear).toBe(true);
    expect(v.flags.items).toEqual([]);
  });

  it("lists each raised flag with the right severity and link", () => {
    const v = buildFinanceOverview(
      inputs({
        flags: loaded({
          ...NO_FLAGS,
          pending_approvals_count: 1,
          fraud_signals_count: 2,
          compliance_overdue_count: 1,
        }),
      })
    );
    expect(v.flags.allClear).toBe(false);
    expect(v.flags.items).toEqual([
      { key: "fraud_signals_count", href: "/finance/fraud", variant: "red", label: "2 fraud signals" },
      {
        key: "compliance_overdue_count",
        href: "/finance/compliance",
        variant: "red",
        label: "1 overdue statutory filing",
      },
      { key: "pending_approvals_count", href: "/finance/approvals", variant: "amber", label: "1 pending approval" },
    ]);
  });

  it("shows bills due soon on their own (they used to be hidden unless another flag was raised)", () => {
    const v = buildFinanceOverview(inputs({ flags: loaded({ ...NO_FLAGS, ap_due_soon_count: 4 }) }));
    expect(v.flags.allClear).toBe(false);
    expect(v.flags.items).toEqual([
      { key: "ap_due_soon_count", href: "/finance/payables", variant: "amber", label: "4 bills due within 7 days" },
    ]);
  });

  it("words the aged-unreconciled flag with its age", () => {
    const v = buildFinanceOverview(inputs({ flags: loaded({ ...NO_FLAGS, aged_unreconciled_count: 1 }) }));
    expect(v.flags.items[0]?.label).toBe("1 unreconciled payment >7 days old");
  });
});
