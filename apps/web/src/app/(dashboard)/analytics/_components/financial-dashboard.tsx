"use client";

import { useState } from "react";
import { Receipt, Repeat, TrendingUp, Wallet } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { StatTile } from "@/components/ui/stat-tile";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import {
  useFinancialSummary,
  useRevenueByProduct,
  useRevenueTimeseries,
  type GrowthPeriod,
} from "@/lib/analytics/queries";
import { formatMinor, formatNumber, formatPercent } from "@/lib/analytics/format";
import { paletteColor } from "./chart-palette";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

const PERIODS: GrowthPeriod[] = ["day", "week", "month"];

export function FinancialDashboard() {
  const [period, setPeriod] = useState<GrowthPeriod>("month");
  const summary = useFinancialSummary();
  const revenue = useRevenueTimeseries(period);
  const byProduct = useRevenueByProduct();

  const s = summary.data;

  // Pivot the (bucket × currency) revenue rows into one row per bucket with a
  // major-unit column per currency, for a multi-series line chart.
  const revRows = revenue.data ?? [];
  const currencies = Array.from(new Set(revRows.map((r) => r.currency ?? "Unknown")));
  const buckets = Array.from(new Set(revRows.map((r) => r.bucket))).sort();
  const revChartData = buckets.map((bucket) => {
    const row: Record<string, string | number> = { bucket };
    for (const c of currencies) {
      row[c] =
        revRows
          .filter((r) => r.bucket === bucket && (r.currency ?? "Unknown") === c)
          .reduce((sum, r) => sum + r.total_minor, 0) / 100;
    }
    return row;
  });
  const revConfig: ChartConfig = Object.fromEntries(
    currencies.map((c, i) => [c, { label: c, color: paletteColor(i) }])
  );

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        The app is free and Tarragon charges per piece of doctor work, so there is no monthly
        recurring revenue and no churn rate to report. Everything below is money actually
        collected against a service a patient bought.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={TrendingUp}
          label="Revenue (last 90 days)"
          value={formatMinor(s?.revenue_90d_kobo ?? 0, "NGN")}
        />
        <StatTile
          icon={Receipt}
          label="Paid services"
          value={formatNumber(s?.paid_purchases ?? 0)}
        />
        <StatTile
          icon={Repeat}
          label="Bought again"
          value={formatPercent(s?.repeat_rate_pct ?? 0)}
        />
        <StatTile
          icon={Wallet}
          label="Receivables"
          value={formatMinor(s?.receivables_kobo ?? 0, "NGN")}
        />
      </div>

      <SectionCard
        title="Revenue over time"
        description="Collected revenue per period, by currency (major units)."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={period === p ? "default" : "outline"}
                  onClick={() => setPeriod(p)}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </Button>
              ))}
            </div>
            <ExportButton filename={`revenue-${period}`} rows={revRows} />
          </div>
        }
      >
        {revenue.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : revChartData.length === 0 ? (
          <CenterNote>No revenue recorded yet.</CenterNote>
        ) : (
          <ChartContainer config={revConfig}>
            <LineChart data={revChartData} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--color-soft-sage)" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {currencies.map((c) => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={`var(--color-${c})`}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Revenue by currency"
          description="All-time, across service purchases and the 12-week programme."
          actions={
            <ExportButton filename="revenue-by-currency" rows={s?.revenue_by_currency ?? []} />
          }
        >
          <MiniBarList
            items={(s?.revenue_by_currency ?? []).map((m) => ({
              label: m.currency ?? "Unknown",
              value: m.total_minor,
              display: formatMinor(m.total_minor, m.currency ?? "NGN"),
            }))}
            emptyLabel="Nothing collected yet."
          />
        </SectionCard>

        <SectionCard
          title="Commissions by status"
          actions={
            <ExportButton filename="commissions-by-status" rows={s?.commissions.by_status ?? []} />
          }
        >
          <MiniBarList
            items={(s?.commissions.by_status ?? []).map((c) => ({
              label: c.status,
              value: c.total_kobo,
              display: `${formatMinor(c.total_kobo, "NGN")} · ${c.count}`,
            }))}
            emptyLabel="No commissions yet."
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Revenue by product"
        description="What each service actually earned, and how many patients bought it."
        actions={<ExportButton filename="revenue-by-product" rows={byProduct.data ?? []} />}
      >
        {byProduct.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (byProduct.data ?? []).length === 0 ? (
          <CenterNote>Nothing has been bought yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Service</th>
                  <th className="py-2 pr-4 font-medium">Currency</th>
                  <th className="py-2 pr-4 text-right font-medium">Purchases</th>
                  <th className="py-2 pr-4 text-right font-medium">Patients</th>
                  <th className="py-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(byProduct.data ?? []).map((p) => (
                  <tr
                    key={`${p.product_code}-${p.currency}`}
                    className="border-b border-charcoal-ink/5"
                  >
                    <td className="py-2 pr-4 text-charcoal-ink/80">{p.product_name}</td>
                    <td className="py-2 pr-4 text-charcoal-ink/60">{p.currency ?? "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(p.purchases)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(p.patients)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMinor(p.revenue_minor, p.currency ?? "NGN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
