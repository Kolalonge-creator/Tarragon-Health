import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { koboToNaira } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";
import { formatMinor, formatNumber, formatPercent } from "@/lib/analytics/format";
import type { FinanceTermKey } from "./definitions";
import type { ResolvedPeriod } from "./periods";
import { transactionHref } from "./transactions";

/**
 * Finance v2 overview: the data behind the homepage KPIs, revenue chart,
 * composition, provider performance and activity feed. One RPC
 * (public.finance_money_overview, migration 20261107015736) so every widget on
 * the page uses the same period and the same definitions.
 */

const minor = z.number().int();

const totalsSchema = z.object({
  from: z.string(),
  to: z.string(),
  gross_payment_volume_minor: minor,
  successful_payments: z.number().int(),
  refunds_minor: minor,
  refund_count: z.number().int(),
  net_collections_minor: minor,
  failed_payments: z.number().int(),
  success_rate: z.number().nullable(),
  customer_fees_minor: minor,
  processing_errors: z.number().int(),
  recognised_revenue_minor: minor,
});
export type MoneyTotals = z.infer<typeof totalsSchema>;

export const moneyOverviewSchema = z.object({
  currency: z.string(),
  granularity: z.enum(["day", "week", "month"]),
  generated_at: z.string(),
  current: totalsSchema,
  previous: totalsSchema.nullable(),
  active_paid_memberships: z.number().int(),
  active_paid_memberships_previous: z.number().int().nullable(),
  open_reconciliation_items: z.number().int(),
  series: z.array(
    z.object({
      bucket: z.string(),
      gross_minor: minor,
      refunds_minor: minor,
      net_minor: minor,
      recognised_minor: minor,
      successful_payments: z.number().int(),
      failed_payments: z.number().int(),
    })
  ),
  composition: z.array(
    z.object({
      payer_type: z.string(),
      amount_minor: minor,
      count: z.number().int(),
      previous_amount_minor: minor.nullable(),
    })
  ),
  streams: z.array(z.object({ stream: z.string(), amount_minor: minor, count: z.number().int(), refunds_minor: minor })),
  providers: z.array(
    z.object({
      provider: z.string(),
      successful: z.number().int(),
      successful_minor: minor,
      failed: z.number().int(),
      refunds_minor: minor,
      processing_errors: z.number().int(),
      success_rate: z.number().nullable(),
    })
  ),
  recent: z.array(
    z.object({
      event_id: z.string(),
      occurred_at: z.string().nullable(),
      event_kind: z.enum(["payment", "refund", "failed_payment"]),
      stream: z.string(),
      payer_type: z.string(),
      provider: z.string(),
      amount_minor: minor,
      currency: z.string(),
      reference: z.string().nullable(),
      record_type: z.string(),
      record_id: z.string(),
      is_renewal: z.boolean(),
      processing_error: z.boolean(),
      payer_label: z.string(),
    })
  ),
});
export type MoneyOverview = z.infer<typeof moneyOverviewSchema>;

export function useMoneyOverview(period: ResolvedPeriod, currency = "NGN") {
  return useQuery({
    queryKey: ["finance", "money-overview", period.from, period.to, period.compareFrom, period.compareTo, currency, period.granularity],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_money_overview", {
        p_from: period.from,
        p_to: period.to,
        p_compare_from: period.compareFrom ?? undefined,
        p_compare_to: period.compareTo ?? undefined,
        p_currency: currency,
        p_granularity: period.granularity,
      });
      if (error) throw error;
      return moneyOverviewSchema.parse(data);
    },
  });
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/** A ratio (0..1, or part/whole) as a percentage. Ratios only, never money: kobo/naira goes through koboToNaira. */
const PERCENT_SCALE = 100;
export function asPercent(part: number, whole = 1): number {
  return (part / whole) * PERCENT_SCALE;
}

export type Delta = { text: string; direction: "up" | "down" | "flat" };

/**
 * A comparison line for a KPI. `goodWhenUp` decides the tone: more refunds or
 * failures is shown in the caution tone even though the number went up. The
 * arrow always shows the real direction of the number.
 * Returns undefined when there is nothing honest to say (no comparison asked
 * for, or no figure for one side).
 */
export function compareDelta(current: number | null, previous: number | null | undefined, goodWhenUp: boolean): Delta | undefined {
  if (previous === null || previous === undefined || current === null) return undefined;
  if (current === previous) return { text: "No change on the comparison period", direction: "flat" };
  const rose = current > previous;
  const tone: Delta["direction"] = rose === goodWhenUp ? "up" : "down";
  const arrow = rose ? "↑" : "↓";
  if (previous === 0) return { text: `${arrow} from none in the comparison period`, direction: tone };
  const pct = asPercent(Math.abs(current - previous), Math.abs(previous));
  return { text: `${arrow} ${formatPercent(pct)} on the comparison period`, direction: tone };
}

/** The change in a rate, in percentage points (75% to 80% is "5 points", not "6.7%"). */
export function rateDelta(current: number | null, previous: number | null | undefined): Delta | undefined {
  if (current === null || previous === null || previous === undefined) return undefined;
  const points = asPercent(current) - asPercent(previous);
  if (Math.abs(points) < 0.05) return { text: "No change on the comparison period", direction: "flat" };
  const arrow = points > 0 ? "↑" : "↓";
  const n = Math.abs(points);
  return { text: `${arrow} ${n.toLocaleString("en-NG", { maximumFractionDigits: 1 })} ${n === 1 ? "point" : "points"} on the comparison period`, direction: points > 0 ? "up" : "down" };
}

export interface KpiTile {
  key: string;
  label: string;
  term: FinanceTermKey;
  value: string;
  delta?: Delta;
  /** The page that lists the records behind the figure; null until that page exists. */
  href: string | null;
  /** Small trend line, in naira (or a count), one point per bucket. */
  spark?: number[];
}

export function buildKpis(data: MoneyOverview): KpiTile[] {
  const c = data.current;
  const p = data.previous;
  const cur = data.currency;
  const money = (v: number) => formatMinor(v, cur);
  const spark = (pick: (s: MoneyOverview["series"][number]) => number) => data.series.map((s) => koboToNaira(pick(s)));
  const rate = (r: number | null) => (r === null ? "No attempts" : formatPercent(asPercent(r)));

  return [
    {
      key: "gpv",
      label: "Gross payment volume",
      term: "gross_payment_volume",
      value: money(c.gross_payment_volume_minor),
      delta: compareDelta(c.gross_payment_volume_minor, p?.gross_payment_volume_minor, true),
      href: "/finance/transactions",
      spark: spark((s) => s.gross_minor),
    },
    {
      key: "net",
      label: "Net collections",
      term: "net_collections",
      value: money(c.net_collections_minor),
      delta: compareDelta(c.net_collections_minor, p?.net_collections_minor, true),
      href: "/finance/transactions",
      spark: spark((s) => s.net_minor),
    },
    {
      key: "recognised",
      label: "Recognised revenue",
      term: "recognised_revenue",
      value: money(c.recognised_revenue_minor),
      delta: compareDelta(c.recognised_revenue_minor, p?.recognised_revenue_minor, true),
      href: "/finance/revenue",
      spark: spark((s) => s.recognised_minor),
    },
    {
      key: "memberships",
      label: "Active paid Memberships",
      term: "active_paid_memberships",
      value: formatNumber(data.active_paid_memberships),
      delta: compareDelta(data.active_paid_memberships, data.active_paid_memberships_previous, true),
      href: null, // Phase C: /finance/memberships
    },
    {
      key: "successful",
      label: "Successful payments",
      term: "successful_payments",
      value: formatNumber(c.successful_payments),
      delta: compareDelta(c.successful_payments, p?.successful_payments, true),
      href: "/finance/transactions",
      spark: data.series.map((s) => s.successful_payments),
    },
    {
      key: "success_rate",
      label: "Payment success rate",
      term: "payment_success_rate",
      value: rate(c.success_rate),
      delta: rateDelta(c.success_rate, p?.success_rate),
      href: "/finance/transactions",
    },
    {
      key: "refunds",
      label: "Refunds",
      term: "refunds",
      value: money(c.refunds_minor),
      delta: compareDelta(c.refunds_minor, p?.refunds_minor, false),
      href: "/finance/refunds",
      spark: spark((s) => s.refunds_minor),
    },
    {
      key: "reconciliation",
      label: "Open reconciliation items",
      term: "open_reconciliation_items",
      value: formatNumber(data.open_reconciliation_items),
      href: "/finance/reconciliation",
    },
  ];
}

export interface CompositionRow {
  payerType: string;
  amountMinor: number;
  count: number;
  /** Share of gross volume, 0..100; null when there was no volume at all. */
  share: number | null;
  delta?: Delta;
}

export function buildComposition(data: MoneyOverview): CompositionRow[] {
  const total = data.composition.reduce((sum, r) => sum + r.amount_minor, 0);
  return data.composition.map((r) => ({
    payerType: r.payer_type,
    amountMinor: r.amount_minor,
    count: r.count,
    share: total === 0 ? null : asPercent(r.amount_minor, total),
    delta: compareDelta(r.amount_minor, r.previous_amount_minor, true),
  }));
}

/** Chart points in naira, labelled for the bucket size. */
export function buildChartSeries(data: MoneyOverview) {
  return data.series.map((s) => ({
    bucket: s.bucket,
    label: bucketLabel(s.bucket, data.granularity),
    gross: koboToNaira(s.gross_minor),
    refunds: koboToNaira(s.refunds_minor),
    net: koboToNaira(s.net_minor),
    recognised: koboToNaira(s.recognised_minor),
  }));
}

export function bucketLabel(iso: string, granularity: MoneyOverview["granularity"]): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  if (granularity === "month") return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return granularity === "week" ? `Week of ${day}` : day;
}

/** True when the period has no money movement at all, so charts show a plain sentence instead of a flat line. */
export function isQuietPeriod(data: MoneyOverview): boolean {
  const c = data.current;
  return c.successful_payments === 0 && c.refund_count === 0 && c.failed_payments === 0 && c.recognised_revenue_minor === 0;
}

/** A link to the record behind an activity-feed event, or null when no finance page shows that record yet. */
/** Every money event opens on the transaction detail page (Phase B). */
export function recordHref(recordType: string, recordId: string): string | null {
  return transactionHref(recordType, recordId);
}
