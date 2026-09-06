"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  useBudgetVariance,
  useBudgets,
  useFinanceAccounts,
  useCostCenters,
  financeKeys,
} from "@/lib/finance/queries";
import { upsertBudgetAction, deleteBudgetAction } from "@/lib/finance/actions";
import { lagosToday, lagosMonth, lagosMonthStart } from "@/lib/format-date";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, majorToMinor } from "./primitives";


export function Budgets() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(lagosMonthStart());
  const [to, setTo] = useState(lagosToday());
  const [currency, setCurrency] = useState("NGN");

  const variance = useBudgetVariance(from, to, currency);
  const budgets = useBudgets();
  const accounts = useFinanceAccounts();
  const costCenters = useCostCenters();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ account_code: "", cost_center_code: "", period_month: lagosMonth(), amount: "" });
  async function save() {
    setMsg(null);
    if (!f.account_code || !f.amount) return setMsg({ ok: false, text: "Account and amount are required." });
    const res = await upsertBudgetAction({
      account_code: f.account_code,
      cost_center_code: f.cost_center_code || undefined,
      period_month: `${f.period_month}-01`,
      currency,
      amount_minor: majorToMinor(f.amount),
    });
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save budget." });
    setMsg({ ok: true, text: "Budget saved." });
    setF({ account_code: "", cost_center_code: "", period_month: lagosMonth(), amount: "" });
    setShowForm(false);
    invalidate();
  }

  async function remove(id: string) {
    const res = await deleteBudgetAction(id);
    if (res.ok) invalidate();
    else setMsg({ ok: false, text: res.error ?? "Could not delete." });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Set a monthly budget per account (optionally per cost center) and compare it against real ledger
        postings for the same period.
      </p>

      {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
        <div><Label>Currency</Label>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
            <option value="NGN">NGN</option><option value="GBP">GBP</option><option value="USD">USD</option>
          </Select>
        </div>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></div>
      </div>

      <SectionCard title="Budget vs actual" description={`${from} to ${to} · ${currency}`}>
        {variance.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (variance.data ?? []).length === 0 ? (
          <CenterNote>No budgets or activity in this range.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Account</Th><Th>Cost center</Th><Th right>Budget</Th><Th right>Actual</Th><Th right>Variance</Th>
              </tr>
            </thead>
            <tbody>
              {(variance.data ?? []).map((r, i) => (
                <tr key={`${r.account_code}-${r.cost_center_code ?? "none"}-${i}`} className="border-b border-charcoal-ink/5">
                  <td className="py-1.5 pr-4 text-charcoal-ink/70">
                    <span className="font-mono text-xs text-charcoal-ink/40">{r.account_code}</span> {r.account_name}
                  </td>
                  <td className="py-1.5 pr-4 text-charcoal-ink/50">{r.cost_center_code ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{formatMinor(r.budget_minor, currency)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{formatMinor(r.actual_minor, currency)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${
                    (r.account_type === "expense" && r.variance_minor > 0) || (r.account_type === "revenue" && r.variance_minor < 0)
                      ? "text-red-600" : "text-brand-green"
                  }`}>
                    {formatMinor(r.variance_minor, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard
        title="Budgets"
        description="Every configured monthly budget line."
        actions={
          <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Hide" : "New budget line"}
          </Button>
        }
      >
        {showForm && (
          <div className="mb-4 grid gap-3 rounded-lg border border-charcoal-ink/10 p-3 sm:grid-cols-4">
            <div>
              <Label>Account</Label>
              <Select value={f.account_code} onChange={(e) => setF((p) => ({ ...p, account_code: e.target.value }))}>
                <option value="">Select…</option>
                {(accounts.data ?? []).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Cost center (optional)</Label>
              <Select value={f.cost_center_code} onChange={(e) => setF((p) => ({ ...p, cost_center_code: e.target.value }))}>
                <option value="">Unassigned</option>
                {(costCenters.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Month</Label>
              <Input type="month" value={f.period_month} onChange={(e) => setF((p) => ({ ...p, period_month: e.target.value }))} />
            </div>
            <div>
              <Label>Amount</Label>
              <Input inputMode="decimal" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="sm:col-span-4 flex justify-end">
              <Button size="sm" onClick={save}>Save budget</Button>
            </div>
          </div>
        )}
        {budgets.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (budgets.data ?? []).length === 0 ? (
          <CenterNote>No budget lines configured yet.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Month</Th><Th>Account</Th><Th>Cost center</Th><Th right>Amount</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {(budgets.data ?? []).map((b) => (
                <tr key={b.id} className="border-b border-charcoal-ink/5">
                  <td className="py-1.5 pr-4 text-charcoal-ink/60">{b.period_month}</td>
                  <td className="py-1.5 pr-4 text-charcoal-ink/70">{b.account_code} · {b.account_name}</td>
                  <td className="py-1.5 pr-4 text-charcoal-ink/50">{b.cost_center_code ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{formatMinor(b.amount_minor, b.currency)}</td>
                  <td className="py-1.5 text-right">
                    <button type="button" className="text-xs text-charcoal-ink/50 hover:text-red-600" onClick={() => remove(b.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>
    </div>
  );
}
