"use client";

import { useRef, useState } from "react";
import { Gauge, Percent, Repeat, TrendingUp } from "lucide-react";
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
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}
function ngn(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : formatMinor(v, "NGN");
}
function ratio(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}×`;
}
function months(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v} mo`;
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
  const { data } = useInvestorSummary();
  const inputs = useFinanceInputs();
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
        Board / diligence view. NRR, GRR and the MRR waterfall build from monthly snapshots (they
        accrue over time). CAC, LTV, burn, runway and Rule of 40 use the finance inputs below —
        modeled figures, not audited.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={TrendingUp} label="ARR (NGN)" value={ngn(data?.arr_minor ?? 0)} />
        <StatTile icon={Repeat} label="Net revenue retention" value={pct(data?.nrr_pct)} />
        <StatTile icon={Percent} label="Gross revenue retention" value={pct(data?.grr_pct)} />
        <StatTile icon={Gauge} label="Rule of 40" value={ue?.rule_of_40 == null ? "—" : formatNumber(ue.rule_of_40)} />
      </div>

      <SectionCard
        title="Unit economics"
        description={ue?.inputs_present ? "Modeled from platform data + your finance inputs." : "Add finance inputs below to compute CAC / LTV / burn / runway."}
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            ["MRR (NGN)", ngn(data?.mrr_minor ?? 0)],
            ["ARPA", ngn(data?.arpa_minor ?? 0)],
            ["MoM growth", pct(data?.mom_growth_pct ?? 0)],
            ["Gross margin", pct(ue?.gross_margin_pct ?? 0)],
            ["LTV", ngn(ue?.ltv_minor)],
            ["CAC", ngn(ue?.cac_minor)],
            ["LTV : CAC", ratio(ue?.ltv_cac_ratio)],
            ["CAC payback", months(ue?.cac_payback_months)],
            ["Net burn / mo", ngn(ue?.net_burn_minor)],
            ["Runway", months(ue?.runway_months)],
            ["Logo churn", pct(data?.logo_churn_pct ?? 0)],
            ["Revenue churn", pct(data?.revenue_churn_pct ?? 0)],
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
          title="MRR waterfall"
          description="Starting → new → churned → ending, per month (from snapshots)."
          actions={<ExportButton filename="mrr-waterfall" rows={data?.mrr_waterfall ?? []} />}
        >
          {(data?.mrr_waterfall ?? []).length === 0 ? (
            <CenterNote>No snapshot history yet.</CenterNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                    <th className="py-2 pr-4 font-medium">Month</th>
                    <th className="py-2 pr-4 text-right font-medium">Starting</th>
                    <th className="py-2 pr-4 text-right font-medium">New</th>
                    <th className="py-2 pr-4 text-right font-medium">Churned</th>
                    <th className="py-2 text-right font-medium">Ending</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.mrr_waterfall ?? []).map((w) => (
                    <tr key={w.month} className="border-b border-charcoal-ink/5">
                      <td className="py-2 pr-4 text-charcoal-ink/70">{w.month}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{ngn(w.starting)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-brand-green">{ngn(w.new_mrr)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-red-700">{ngn(w.churned_mrr)}</td>
                      <td className="py-2 text-right tabular-nums font-medium">{ngn(w.ending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Revenue concentration"
          description="Share of MRR by plan."
          actions={<ExportButton filename="revenue-concentration" rows={data?.concentration ?? []} />}
        >
          <MiniBarList
            items={(data?.concentration ?? []).map((x) => ({
              label: x.plan,
              value: x.mrr_minor,
              display: `${formatMinor(x.mrr_minor, "NGN")} · ${x.pct}%`,
            }))}
            emptyLabel="No active subscriptions."
          />
        </SectionCard>
      </div>

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

        {(inputs.data ?? []).length === 0 ? (
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
