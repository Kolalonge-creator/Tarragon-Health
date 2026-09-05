"use client";

import { useRef, useState } from "react";
import { Gauge, Receipt, Repeat, TrendingUp } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useFinanceInputs,
  useInvestorSummary,
  useUpsertFinanceInput,
} from "@/lib/analytics/queries";
import { formatMinor, formatNumber } from "@/lib/analytics/format";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { refreshQueryState } from "@/lib/queries/list-query-state";
import { statTileValue, type StatTileValueProps } from "@/components/ui/stat-tile-value";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

/**
 * These three already answered "not known" with a dash. Every call site then
 * wrote `ngn(data?.revenue_12m_minor ?? 0)`, which reaches the helper with a
 * real zero and prints ₦0.00 — so the one piece of honesty built into the
 * page was defeated everywhere it was used, and a board view rendered a
 * business with no revenue, no paying patients and no growth rather than a
 * page that could not read them. The `?? 0`s are gone; the failure of the
 * whole summary is handled separately below, because a dash per tile is the
 * right answer for a genuinely absent figure and the wrong one for a read
 * that never happened.
 */
function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}
function ngn(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : formatMinor(v, "NGN");
}
function months(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v} mo`;
}

/** StatTile forbids a bare display-scale dash, so an absent figure becomes
 * its muted `empty` hint instead. See components/ui/stat-tile-value.ts. */
function tile(
  v: number | null | undefined,
  format: (n: number) => string
): StatTileValueProps {
  return statTileValue(v === null || v === undefined ? null : format(v), "Not available yet");
}

const BLANK = {
  month: new Date().toISOString().slice(0, 7),
  marketing: "",
  opex: "",
  cash: "",
  margin: "",
  new_customers: "",
};

export function InvestorDashboard() {
  const summary = useInvestorSummary();
  const data = summary.data;
  const inputs = useFinanceInputs();
  const summaryState = refreshQueryState({
    isLoading: summary.isLoading,
    isError: summary.isError,
    hasData: summary.data !== undefined,
  });
  const inputsState = refreshQueryState({
    isLoading: inputs.isLoading,
    isError: inputs.isError,
    hasData: inputs.data !== undefined,
  });
  const upsert = useUpsertFinanceInput();
  const [form, setForm] = useState(BLANK);
  const fileRef = useRef<HTMLInputElement>(null);

  const ue = data?.unit_economics;

  function submit() {
    if (!form.month) return;
    upsert.mutate(
      {
        month: `${form.month}-01`,
        currency: "NGN",
        marketing_spend_minor: Math.round(Number(form.marketing || 0) * 100),
        operating_expense_minor: Math.round(Number(form.opex || 0) * 100),
        cash_balance_minor: Math.round(Number(form.cash || 0) * 100),
        gross_margin_pct: Number(form.margin || 0),
        new_customers: form.new_customers ? Number(form.new_customers) : null,
      },
      { onSuccess: () => setForm({ ...BLANK, month: form.month }) }
    );
  }

  // CSV import: period_month,marketing_spend,operating_expense,cash_balance,gross_margin_pct,new_customers
  function importCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const start = /period_month/i.test(lines[0] ?? "") ? 1 : 0;
      for (const line of lines.slice(start)) {
        const [month, mk, opx, cash, margin, nc] = line.split(",").map((s) => s.trim());
        if (!month) continue;
        upsert.mutate({
          month: month.length === 7 ? `${month}-01` : month,
          currency: "NGN",
          marketing_spend_minor: Math.round(Number(mk || 0) * 100),
          operating_expense_minor: Math.round(Number(opx || 0) * 100),
          cash_balance_minor: Math.round(Number(cash || 0) * 100),
          gross_margin_pct: Number(margin || 0),
          new_customers: nc ? Number(nc) : null,
        });
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Board / diligence view, built on revenue actually collected. Tarragon sells pieces of
        doctor work rather than subscriptions, so there is no MRR, ARR, net or gross revenue
        retention, and no LTV: each of those is a function of a recurring contract and a churn
        rate this business does not have. CAC, burn, runway and Rule of 40 use the finance inputs
        below and are modeled figures, not audited.
      </p>

      {summaryState === "stale" && (
        <StaleDataNotice>
          These board figures could not be refreshed just now. They are the last ones we read
          successfully, not a current position. Reload before quoting any of them.
        </StaleDataNotice>
      )}

      {summaryState === "failed" ? (
        <LoadFailure>
          The board figures could not be loaded. Revenue, paying patients, repeat rate and Rule of
          40 are unknown rather than zero, and nothing on this page should be quoted or exported
          until it loads. Reload to try again.
        </LoadFailure>
      ) : (
        <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={TrendingUp} label="Revenue (last 12 months)" {...tile(data?.revenue_12m_minor, (n) => formatMinor(n, "NGN"))} />
        <StatTile icon={Receipt} label="Paying patients" {...tile(data?.paying_patients, formatNumber)} />
        <StatTile icon={Repeat} label="Bought again" {...tile(data?.repeat_rate_pct, (n) => `${n}%`)} />
        <StatTile icon={Gauge} label="Rule of 40" {...tile(ue?.rule_of_40, formatNumber)} />
      </div>

      <SectionCard
        title="Unit economics"
        description={ue?.inputs_present ? "Modeled from platform data + your finance inputs." : "Add finance inputs below to compute CAC / burn / runway."}
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            ["Revenue (30d)", ngn(data?.revenue_30d_minor)],
            ["Revenue (90d)", ngn(data?.revenue_90d_minor)],
            ["Revenue per paying patient", ngn(data?.arppu_minor)],
            ["MoM growth", pct(data?.mom_growth_pct)],
            ["Gross margin", pct(ue?.gross_margin_pct)],
            ["CAC", ngn(ue?.cac_minor)],
            ["Net burn / mo", ngn(ue?.net_burn_minor)],
            ["Runway", months(ue?.runway_months)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-charcoal-ink/10 bg-white p-3">
              <p className="text-xs text-charcoal-ink/60">{label}</p>
              <p className="font-heading text-xl font-semibold text-charcoal-ink">{value}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Revenue by month"
          description="Collected revenue, purchases and paying patients, per month."
          actions={<ExportButton filename="revenue-by-month" rows={data?.revenue_by_month ?? []} />}
        >
          {(data?.revenue_by_month ?? []).length === 0 ? (
            <CenterNote>No revenue recorded yet.</CenterNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                    <th className="py-2 pr-4 font-medium">Month</th>
                    <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                    <th className="py-2 pr-4 text-right font-medium">Purchases</th>
                    <th className="py-2 text-right font-medium">Paying patients</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.revenue_by_month ?? []).map((m) => (
                    <tr key={m.month} className="border-b border-charcoal-ink/5">
                      <td className="py-2 pr-4 text-charcoal-ink/70">{m.month}</td>
                      <td className="py-2 pr-4 text-right tabular-nums font-medium">{ngn(m.revenue_minor)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(m.purchases)}</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(m.paying_patients)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Revenue concentration"
          description="Share of the last 12 months of revenue, by service."
          actions={<ExportButton filename="revenue-concentration" rows={data?.concentration ?? []} />}
        >
          <MiniBarList
            items={(data?.concentration ?? []).map((x) => ({
              label: x.product,
              value: x.revenue_minor,
              display: `${formatMinor(x.revenue_minor, "NGN")} · ${x.pct}%`,
            }))}
            emptyLabel="Nothing has been bought yet."
          />
        </SectionCard>
      </div>
        </>
      )}

      <SectionCard
        title="Finance inputs"
        description="Monthly ad spend, opex, cash and gross margin (major units, ₦). Edit inline or import CSV."
        actions={
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCsv(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              Import CSV
            </Button>
            <ExportButton filename="finance-inputs" rows={inputs.data ?? []} />
          </div>
        }
      >
        <div className="mb-4 grid gap-3 rounded-lg border border-charcoal-ink/10 bg-white p-3 md:grid-cols-7">
          <div>
            <Label htmlFor="fi-month">Month</Label>
            <Input id="fi-month" type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="fi-mk">Ad spend ₦</Label>
            <Input id="fi-mk" inputMode="numeric" value={form.marketing} onChange={(e) => setForm({ ...form, marketing: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="fi-opx">Opex ₦</Label>
            <Input id="fi-opx" inputMode="numeric" value={form.opex} onChange={(e) => setForm({ ...form, opex: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="fi-cash">Cash ₦</Label>
            <Input id="fi-cash" inputMode="numeric" value={form.cash} onChange={(e) => setForm({ ...form, cash: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="fi-margin">Margin %</Label>
            <Input id="fi-margin" inputMode="numeric" value={form.margin} onChange={(e) => setForm({ ...form, margin: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="fi-nc">New cust.</Label>
            <Input id="fi-nc" inputMode="numeric" value={form.new_customers} onChange={(e) => setForm({ ...form, new_customers: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={submit} disabled={upsert.isPending || !form.month}>
              Save month
            </Button>
          </div>
        </div>

        {/* "No finance inputs yet." from a failed read invites somebody to
            re-enter a month that is already saved, silently overwriting it. */}
        {inputsState === "failed" ? (
          <LoadFailure>
            The saved finance inputs could not be loaded. This is not a report that none exist, so
            do not re-enter a month from here until it loads.
          </LoadFailure>
        ) : (inputs.data ?? []).length === 0 ? (
          <CenterNote>No finance inputs yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Month</th>
                  <th className="py-2 pr-4 text-right font-medium">Ad spend</th>
                  <th className="py-2 pr-4 text-right font-medium">Opex</th>
                  <th className="py-2 pr-4 text-right font-medium">Cash</th>
                  <th className="py-2 pr-4 text-right font-medium">Margin</th>
                  <th className="py-2 text-right font-medium">New cust.</th>
                </tr>
              </thead>
              <tbody>
                {(inputs.data ?? []).map((f) => (
                  <tr key={`${f.period_month}-${f.currency}`} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 text-charcoal-ink/70">{f.period_month}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(f.marketing_spend_minor, f.currency)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(f.operating_expense_minor, f.currency)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(f.cash_balance_minor, f.currency)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{f.gross_margin_pct}%</td>
                    <td className="py-2 text-right tabular-nums">{f.new_customers ?? "—"}</td>
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
