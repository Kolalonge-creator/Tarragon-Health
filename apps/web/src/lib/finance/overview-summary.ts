import { formatMinor, formatNumber } from "@/lib/analytics/format";
import { statTileValue, type StatTileValueProps } from "@/components/ui/stat-tile-value";
import { refreshQueryState, type RefreshQueryState } from "@/lib/queries/list-query-state";
import type { DashboardSummary, KpiSummary, RevenueByFundingSource, RiskFlags } from "./schemas";

/**
 * What the Finance overview shows, worked out apart from the component so the
 * rules can be tested without rendering or a QueryClient.
 *
 * Why it exists. The overview read every figure as `data?.x ?? 0`, so while a
 * query was still loading, or after it failed, the books showed ₦0 for cash,
 * revenue, tax payable and prepayments. A failed risk-flags read was worse: no
 * flags meant the "Needs attention" section was simply not drawn, which reads
 * as "all clear" when the unread flags are fraud signals, overdue statutory
 * filings and unreconciled payments. And a failed background refresh replaced a
 * screen of good figures with a single error line.
 *
 * Rules here: a figure with no data is "unknown" (loading, or could not be
 * loaded) and is never 0; a figure the ledger genuinely has no value for (for
 * example growth with no prior month) says so; a failed refresh that still has
 * data on screen keeps the data and is marked out of date.
 *
 * A caller who is not finance is refused by every one of these RPCs with `{}`.
 * Their schemas require every field, so `{}` fails the parse and reaches this
 * module as an error, not as a row of zeros. overview-summary.test.ts pins
 * that, so adding defaults to one of those schemas fails a test.
 */

/** The part of a TanStack Query result this needs. */
export interface QuerySlice<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
}

const LOADING = "Loading…";
const NOT_LOADED = "Could not be loaded";
const NO_HISTORY = "Not enough data yet";

export function sectionState<T>(q: QuerySlice<T>): RefreshQueryState {
  return refreshQueryState({
    isLoading: q.isLoading,
    isError: q.isError,
    hasData: q.data !== undefined,
  });
}

/**
 * A tile value. Data present: the read value, or `whenNull` if the ledger has
 * no figure for this metric. No data: loading, or could not be loaded. Never 0.
 */
function tile<T>(
  q: QuerySlice<T>,
  read: (data: T) => string | null,
  whenNull: string = NO_HISTORY
): StatTileValueProps {
  if (q.data !== undefined) return statTileValue(read(q.data), whenNull);
  return statTileValue(null, q.isError ? NOT_LOADED : LOADING);
}

/** The same rule for plain text rows. */
function text<T>(
  q: QuerySlice<T>,
  read: (data: T) => string | null,
  whenNull: string = NO_HISTORY
): string {
  if (q.data !== undefined) return read(q.data) ?? whenNull;
  return q.isError ? NOT_LOADED : LOADING;
}

const ngn = (minor: number) => formatMinor(minor, "NGN");

function pct(v: number | null): string | null {
  return v === null ? null : `${v > 0 ? "+" : ""}${v}%`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface FlagItem {
  key: keyof RiskFlags;
  href: string;
  variant: "amber" | "red";
  label: string;
}

function flagItems(f: RiskFlags): FlagItem[] {
  const items: FlagItem[] = [];
  if (f.pending_approvals_count > 0)
    items.push({
      key: "pending_approvals_count",
      href: "/finance/approvals",
      variant: "amber",
      label: plural(f.pending_approvals_count, "pending approval", "pending approvals"),
    });
  if (f.aged_unreconciled_count > 0)
    items.push({
      key: "aged_unreconciled_count",
      href: "/finance/reconciliation",
      variant: "red",
      label: `${plural(f.aged_unreconciled_count, "unreconciled payment", "unreconciled payments")} >7 days old`,
    });
  if (f.reconciliation_flags_count > 0)
    items.push({
      key: "reconciliation_flags_count",
      href: "/finance/reconciliation",
      variant: "red",
      label: plural(f.reconciliation_flags_count, "reconciliation flag", "reconciliation flags"),
    });
  if (f.fraud_signals_count > 0)
    items.push({
      key: "fraud_signals_count",
      href: "/finance/fraud",
      variant: "red",
      label: plural(f.fraud_signals_count, "fraud signal", "fraud signals"),
    });
  if (f.ap_overdue_count > 0)
    items.push({
      key: "ap_overdue_count",
      href: "/finance/payables",
      variant: "red",
      label: plural(f.ap_overdue_count, "overdue bill", "overdue bills"),
    });
  if (f.ap_due_soon_count > 0)
    items.push({
      key: "ap_due_soon_count",
      href: "/finance/payables",
      variant: "amber",
      label: `${plural(f.ap_due_soon_count, "bill", "bills")} due within 7 days`,
    });
  if (f.compliance_overdue_count > 0)
    items.push({
      key: "compliance_overdue_count",
      href: "/finance/compliance",
      variant: "red",
      label: plural(f.compliance_overdue_count, "overdue statutory filing", "overdue statutory filings"),
    });
  return items;
}

export interface FinanceOverviewInputs {
  dashboard: QuerySlice<DashboardSummary>;
  kpis: QuerySlice<KpiSummary>;
  funding: QuerySlice<RevenueByFundingSource>;
  flags: QuerySlice<RiskFlags>;
}

export interface CurrencyRow {
  currency: string;
  amount: string;
}

export interface FinanceOverview {
  dashboard: {
    state: RefreshQueryState;
    tiles: {
      cash: StatTileValueProps;
      revenueYtd: StatTileValueProps;
      deferred: StatTileValueProps;
      receivables: StatTileValueProps;
      vat: StatTileValueProps;
      wht: StatTileValueProps;
      prepayments: StatTileValueProps;
      unreconciled: StatTileValueProps;
    };
    /** "unknown" is not the same as "no revenue booked yet". */
    revenueByCurrency: {
      status: "unknown" | "empty" | "ready";
      rows: CurrencyRow[];
      /** What to say in place of the list when its status is "unknown". */
      message: string;
    };
    ledger: { openPeriod: string; entries: string; revenueMtd: string; expensesYtd: string };
  };
  flags: {
    state: RefreshQueryState;
    items: FlagItem[];
    /** True only when the flags were read and there are none. */
    allClear: boolean;
  };
  kpis: {
    state: RefreshQueryState;
    tiles: {
      grossMargin: StatTileValueProps;
      netMargin: StatTileValueProps;
      momGrowth: StatTileValueProps;
      yoyGrowth: StatTileValueProps;
      dso: StatTileValueProps;
      runway: StatTileValueProps;
    };
  };
  funding: {
    state: RefreshQueryState;
    tiles: { cash: StatTileValueProps; promotional: StatTileValueProps };
  };
}

export function buildFinanceOverview(inputs: FinanceOverviewInputs): FinanceOverview {
  const { dashboard: d, kpis: k, funding: f, flags: fl } = inputs;

  const dashState = sectionState(d);
  const flagState = sectionState(fl);
  const items = fl.data !== undefined ? flagItems(fl.data) : [];

  let revenueByCurrency: FinanceOverview["dashboard"]["revenueByCurrency"];
  if (d.data === undefined)
    revenueByCurrency = { status: "unknown", rows: [], message: d.isError ? NOT_LOADED : LOADING };
  else if (d.data.revenue_by_currency.length === 0)
    revenueByCurrency = { status: "empty", rows: [], message: "" };
  else
    revenueByCurrency = {
      status: "ready",
      message: "",
      rows: d.data.revenue_by_currency.map((r) => ({
        currency: r.currency ?? "—",
        amount: formatMinor(r.recognised_minor, r.currency ?? "NGN"),
      })),
    };

  return {
    dashboard: {
      state: dashState,
      tiles: {
        cash: tile(d, (x) => ngn(x.cash_ngn)),
        revenueYtd: tile(d, (x) => ngn(x.revenue_ytd_ngn)),
        deferred: tile(d, (x) => ngn(x.deferred_revenue_ngn)),
        receivables: tile(d, (x) => ngn(x.receivables_ngn)),
        vat: tile(d, (x) => ngn(x.vat_payable_ngn)),
        wht: tile(d, (x) => ngn(x.wht_payable_ngn)),
        prepayments: tile(d, (x) => ngn(x.care_voucher_liability_ngn)),
        unreconciled: tile(d, (x) => formatNumber(x.unreconciled.count)),
      },
      revenueByCurrency,
      ledger: {
        openPeriod: text(d, (x) => x.open_period, "No open period"),
        entries: text(d, (x) => formatNumber(x.entries_count)),
        revenueMtd: text(d, (x) => ngn(x.revenue_mtd_ngn)),
        expensesYtd: text(d, (x) => ngn(x.expenses_ytd_ngn)),
      },
    },
    flags: {
      state: flagState,
      items,
      allClear: fl.data !== undefined && !fl.isError && items.length === 0,
    },
    kpis: {
      state: sectionState(k),
      tiles: {
        grossMargin: tile(k, (x) => (x.gross_margin_pct === null ? null : `${x.gross_margin_pct}%`), NO_HISTORY),
        netMargin: tile(k, (x) => (x.net_margin_pct === null ? null : `${x.net_margin_pct}%`), NO_HISTORY),
        momGrowth: tile(k, (x) => pct(x.mom_revenue_growth_pct), NO_HISTORY),
        yoyGrowth: tile(k, (x) => pct(x.yoy_revenue_growth_pct), NO_HISTORY),
        dso: tile(k, (x) => (x.dso_days === null ? null : `${x.dso_days}d`), NO_HISTORY),
        runway: tile(k, (x) => (x.cash_runway_months === null ? null : `${x.cash_runway_months} mo`), NO_HISTORY),
      },
    },
    funding: {
      state: sectionState(f),
      tiles: {
        cash: tile(f, (x) => ngn(x.cash_minor)),
        promotional: tile(f, (x) => ngn(x.promotional_minor)),
      },
    },
  };
}
