"use client";

import Link from "next/link";
import { useState } from "react";
import { Info, RefreshCw, Download } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { formatMinor, formatNumber, formatPercent } from "@/lib/analytics/format";
import { financeTerm, PAYER_TYPE_LABEL, providerLabel, streamLabel } from "@/lib/finance/definitions";
import {
  asPercent,
  buildChartSeries,
  buildComposition,
  buildKpis,
  isQuietPeriod,
  recordHref,
  useMoneyOverview,
  type KpiTile,
  type MoneyOverview,
} from "@/lib/finance/money-overview";
import { PeriodSelector, useFinancePeriod } from "./period-selector";
import { CenterNote, SectionCard, TableShell, Th } from "./primitives";

const DELTA_TONE = {
  up: "text-brand-green dark:text-brand-green-bright",
  down: "text-status-attention-text dark:text-sprout-gold",
  flat: "text-charcoal-ink/50 dark:text-night-ink/55",
} as const;

function Sparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2 || points.every((p) => p === 0)) return null;
  const data = points.map((v, i) => ({ i, v }));
  return (
    <div className="h-8 w-24" role="img" aria-label={`${label} trend across the period`}>
      <ChartContainer config={{ v: { label, color: "var(--chart-analytics-1)" } }} className="h-8 w-24">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="v" stroke="var(--color-v)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function KpiCard({ tile }: { tile: KpiTile }) {
  const term = financeTerm(tile.term);
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">{tile.label}</p>
        <Link
          href={`/finance/glossary#${tile.term}`}
          className="text-charcoal-ink/40 hover:text-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:text-night-ink/45"
          aria-label={`What ${tile.label} means`}
          title={term.definition}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="font-heading text-2xl font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">{tile.value}</p>
        {tile.spark && <Sparkline points={tile.spark} label={tile.label} />}
      </div>
      {tile.delta && <p className={`mt-1 text-xs ${DELTA_TONE[tile.delta.direction]}`}>{tile.delta.text}</p>}
    </>
  );
  return (
    <div className="rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
      {body}
      {tile.href && (
        <Link href={tile.href} className="mt-2 inline-block text-xs font-medium text-brand-green hover:underline dark:text-brand-green-bright">
          See the records →
        </Link>
      )}
    </div>
  );
}

const CHART_CONFIG: ChartConfig = {
  gross: { label: "Gross payments (₦)", color: "var(--chart-analytics-1)" },
  refunds: { label: "Refunds (₦)", color: "var(--chart-analytics-3)" },
  net: { label: "Net collections (₦)", color: "var(--chart-analytics-2)" },
  recognised: { label: "Recognised revenue (₦)", color: "var(--chart-analytics-4)" },
};

type SeriesKey = keyof typeof CHART_CONFIG;

function RevenueChart({ data }: { data: MoneyOverview }) {
  const [shown, setShown] = useState<Record<SeriesKey, boolean>>({ gross: true, refunds: true, net: true, recognised: false });
  const points = buildChartSeries(data);

  return (
    <SectionCard
      title="Revenue performance"
      description="Payments, refunds and net collections by the day each payment was confirmed. Recognised revenue follows the ledger's own dates, so it can differ from cash in the same bucket."
    >
      <fieldset className="mb-3 flex flex-wrap gap-2">
        <legend className="sr-only">Series shown</legend>
        {(Object.keys(CHART_CONFIG) as SeriesKey[]).map((k) => (
          <label
            key={k}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-charcoal-ink/15 px-3 py-1 text-xs text-charcoal-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-green dark:border-night-ink/20 dark:text-night-ink"
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={shown[k]}
              onChange={() => setShown((s) => ({ ...s, [k]: !s[k] }))}
            />
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: shown[k] ? CHART_CONFIG[k].color : "transparent", border: `1.5px solid ${CHART_CONFIG[k].color}` }}
            />
            {CHART_CONFIG[k].label}
            <span className="sr-only">{shown[k] ? "(shown)" : "(hidden)"}</span>
          </label>
        ))}
      </fieldset>
      {isQuietPeriod(data) ? (
        <CenterNote>No payments, refunds or recognised revenue in this period.</CenterNote>
      ) : (
        <ChartContainer config={CHART_CONFIG} className="h-72">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(v: number) => `₦${Intl.NumberFormat("en-NG", { notation: "compact" }).format(v)}`}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {(Object.keys(CHART_CONFIG) as SeriesKey[])
              .filter((k) => shown[k])
              .map((k) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={`var(--color-${k})`}
                  fill={`var(--color-${k})`}
                  fillOpacity={k === "gross" ? 0.12 : 0}
                  strokeWidth={k === "net" ? 2 : 1.5}
                  strokeDasharray={k === "recognised" ? "4 3" : undefined}
                  isAnimationActive={false}
                />
              ))}
          </AreaChart>
        </ChartContainer>
      )}
    </SectionCard>
  );
}

function Composition({ data }: { data: MoneyOverview }) {
  const rows = buildComposition(data);
  const total = rows.reduce((s, r) => s + r.amountMinor, 0);
  return (
    <SectionCard title="Who paid" description="Gross payment volume by payer. A family sponsor paid for someone else; that gives them no access to the member's record.">
      {total === 0 ? (
        <CenterNote>No payments in this period.</CenterNote>
      ) : (
        <ul className="space-y-4">
          {rows.map((r, i) => (
            <li key={r.payerType}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-charcoal-ink dark:text-night-ink">{PAYER_TYPE_LABEL[r.payerType] ?? r.payerType}</span>
                <span className="tabular-nums font-medium text-charcoal-ink dark:text-night-ink">
                  {formatMinor(r.amountMinor, data.currency)}
                  <span className="ml-2 text-xs font-normal text-charcoal-ink/60 dark:text-night-ink/60">
                    {r.share === null ? "" : formatPercent(r.share)} · {formatNumber(r.count)} {r.count === 1 ? "payment" : "payments"}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-soft-sage dark:bg-night-ink/10" aria-hidden>
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${r.share ?? 0}%`, background: `var(--chart-analytics-${i + 1})` }}
                />
              </div>
              {r.delta && <p className={`mt-1 text-xs ${DELTA_TONE[r.delta.direction]}`}>{r.delta.text}</p>}
            </li>
          ))}
        </ul>
      )}
      {data.streams.length > 0 && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">By what was bought</summary>
          <TableShell>
            <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              <tr>
                <Th>Stream</Th>
                <Th right>Payments</Th>
                <Th right>Gross</Th>
                <Th right>Refunds</Th>
              </tr>
            </thead>
            <tbody>
              {data.streams.map((s) => (
                <tr key={s.stream} className="border-t border-charcoal-ink/5 dark:border-night-ink/10">
                  <td className="py-2 pr-4">{streamLabel(s.stream)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(s.count)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(s.amount_minor, data.currency)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(s.refunds_minor, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </details>
      )}
    </SectionCard>
  );
}

function PaymentPerformance({ data }: { data: MoneyOverview }) {
  const c = data.current;
  return (
    <SectionCard title="Payment performance" description="Outcomes of payment attempts, by provider. Paystack is the only live card provider.">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Successful", formatNumber(c.successful_payments)],
          ["Failed", formatNumber(c.failed_payments)],
          ["Refunded", formatNumber(c.refund_count)],
          ["Success rate", c.success_rate === null ? "No attempts" : formatPercent(asPercent(c.success_rate))],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{label}</dt>
            <dd className="mt-0.5 font-heading text-lg font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {c.processing_errors > 0 && (
        <p className="mt-3 rounded-md bg-status-attention-tint px-3 py-2 text-xs text-status-attention-text">
          {formatNumber(c.processing_errors)} {c.processing_errors === 1 ? "payment was" : "payments were"} taken by the provider but not
          applied by our system. The money is counted above; check that each payer received what they paid for.
        </p>
      )}
      {data.providers.length === 0 ? (
        <CenterNote>No payment attempts in this period.</CenterNote>
      ) : (
        <div className="mt-4">
          <TableShell>
            <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              <tr>
                <Th>Provider</Th>
                <Th right>Successful</Th>
                <Th right>Value</Th>
                <Th right>Failed</Th>
                <Th right>Success rate</Th>
                <Th right>Refunds</Th>
              </tr>
            </thead>
            <tbody>
              {data.providers.map((p) => (
                <tr key={p.provider} className="border-t border-charcoal-ink/5 dark:border-night-ink/10">
                  <td className="py-2 pr-4">{providerLabel(p.provider)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(p.successful)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(p.successful_minor, data.currency)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(p.failed)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {p.success_rate === null ? "No attempts" : formatPercent(asPercent(p.success_rate))}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(p.refunds_minor, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}
    </SectionCard>
  );
}

const KIND_BADGE = {
  payment: { label: "Payment", variant: "normal" },
  refund: { label: "Refund", variant: "info" },
  failed_payment: { label: "Failed", variant: "attention" },
} as const;

function ActivityFeed({ data }: { data: MoneyOverview }) {
  return (
    <SectionCard title="Recent financial activity" description="The latest payments, failed payments and confirmed refunds, whatever the period. No health information is shown.">
      {data.recent.length === 0 ? (
        <CenterNote>No payments or refunds recorded yet.</CenterNote>
      ) : (
        <ul className="divide-y divide-charcoal-ink/5 dark:divide-night-ink/10">
          {data.recent.map((e) => {
            const href = recordHref(e.record_type, e.record_id);
            const kind = KIND_BADGE[e.event_kind];
            const what = `${streamLabel(e.stream)}${e.is_renewal ? " renewal" : ""}`;
            const main = (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-charcoal-ink dark:text-night-ink">
                    <Badge variant={kind.variant} className="mr-2">{kind.label}</Badge>
                    {what} · {e.payer_label}
                    {e.payer_type === "family_sponsor" && <span className="text-charcoal-ink/60 dark:text-night-ink/60"> (sponsor)</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    {e.occurred_at
                      ? new Date(e.occurred_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })
                      : "Date not recorded"}
                    {" · "}
                    {providerLabel(e.provider)}
                    {e.reference ? ` · Ref ${e.reference}` : ""}
                    {e.processing_error ? " · not applied by our system" : ""}
                  </p>
                </div>
                <p className={`tabular-nums font-medium ${e.event_kind === "refund" ? "text-charcoal-ink/70 dark:text-night-ink/70" : "text-charcoal-ink dark:text-night-ink"}`}>
                  {e.event_kind === "refund" ? "−" : ""}
                  {formatMinor(e.amount_minor, e.currency)}
                </p>
              </div>
            );
            return <li key={e.event_id}>{href ? <Link href={href} className="block hover:bg-soft-sage/40">{main}</Link> : main}</li>;
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/** A CSV of the summary figures for the period, generated in the browser from what is on screen. */
function summaryCsv(data: MoneyOverview, periodLabel: string, compareLabel: string | null): string {
  const c = data.current;
  const p = data.previous;
  const rows: [string, number | string, number | string][] = [
    ["Measure", `Current (${periodLabel})`, compareLabel ? `Comparison (${compareLabel})` : "Comparison"],
    ["Gross payment volume (kobo)", c.gross_payment_volume_minor, p?.gross_payment_volume_minor ?? ""],
    ["Refunds (kobo)", c.refunds_minor, p?.refunds_minor ?? ""],
    ["Net collections (kobo)", c.net_collections_minor, p?.net_collections_minor ?? ""],
    ["Recognised revenue (kobo)", c.recognised_revenue_minor, p?.recognised_revenue_minor ?? ""],
    ["Successful payments", c.successful_payments, p?.successful_payments ?? ""],
    ["Failed payments", c.failed_payments, p?.failed_payments ?? ""],
    ["Payment success rate", c.success_rate ?? "", p?.success_rate ?? ""],
    ["Card fees paid by payers (kobo)", c.customer_fees_minor, p?.customer_fees_minor ?? ""],
    ["Active paid Memberships", data.active_paid_memberships, data.active_paid_memberships_previous ?? ""],
  ];
  const escape = (v: number | string) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = rows.map((r) => r.map(escape).join(","));
  lines.push("", `Currency,${data.currency}`, `Generated,${data.generated_at}`, "Source,public.finance_money_overview; definitions at /finance/glossary");
  return lines.join("\n");
}

export function MoneyOverviewSection() {
  const period = useFinancePeriod();
  const q = useMoneyOverview(period);
  const data = q.data;
  const compareLabel = period.compareFrom && period.compareTo ? `${period.compareFrom} to ${period.compareTo}` : null;

  function exportCsv() {
    if (!data) return;
    const blob = new Blob([summaryCsv(data, `${period.from} to ${period.to}`, compareLabel)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tarragon-finance-summary-${period.from}-to-${period.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
        <PeriodSelector period={period} />
        <div className="flex flex-wrap items-center gap-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          <span>
            <span className="font-medium text-charcoal-ink dark:text-night-ink">{period.label}</span>
            {compareLabel ? ` · compared with ${compareLabel}` : ""} · NGN
          </span>
          {data && <span>Updated {new Date(data.generated_at).toLocaleTimeString("en-GB", { timeStyle: "short", timeZone: "Africa/Lagos" })}</span>}
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} aria-label="Refresh figures">
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden />
            Export summary
          </Button>
        </div>
      </div>

      {q.isError && !data && (
        <LoadFailure>
          The money figures could not be loaded, so nothing is shown rather than zeros. This can also happen if your finance
          access has changed. Reload the page to try again.
        </LoadFailure>
      )}
      {q.isError && data && (
        <StaleDataNotice>
          The figures below may be out of date: the last refresh failed. They are the last ones read successfully. Reload the page to try again.
        </StaleDataNotice>
      )}
      {q.isLoading && <CenterNote>Loading the period&apos;s figures…</CenterNote>}

      {data && (
        <>
          <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {buildKpis(data).map((t) => (
              <KpiCard key={t.key} tile={t} />
            ))}
          </section>
          <RevenueChart data={data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Composition data={data} />
            <PaymentPerformance data={data} />
          </div>
          <ActivityFeed data={data} />
        </>
      )}
    </div>
  );
}
