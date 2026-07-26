"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useFinancePeriods, useFinanceAccounts, financeKeys } from "@/lib/finance/queries";
import { setPeriodStatusAction, upsertAccountAction } from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th } from "./primitives";
import type { FinanceAccount } from "@/lib/finance/schemas";

const STATUS_VARIANT: Record<string, "green" | "amber" | "grey"> = {
  open: "green",
  closed: "amber",
  locked: "grey",
};

export function FinanceSettings() {
  const qc = useQueryClient();
  const periods = useFinancePeriods();
  const accounts = useFinanceAccounts();
  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  async function setStatus(month: string, status: "open" | "closed" | "locked") {
    const res = await setPeriodStatusAction(`${month}-01`, status);
    if (res.ok) invalidate();
    else window.alert(res.error ?? "Could not update period.");
  }

  async function setVat(a: FinanceAccount, vat: string) {
    const res = await upsertAccountAction({
      code: a.code,
      name: a.name,
      type: a.type,
      normal_balance: a.normal_balance,
      vat_treatment: vat,
      is_active: a.is_active,
      sort_order: a.sort_order,
      description: a.description ?? "",
    });
    if (res.ok) invalidate();
    else window.alert(res.error ?? "Could not update account.");
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Accounting periods"
        description="Close a month to lock it against further posting. Locked periods can't be reopened without care."
      >
        {periods.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (periods.data ?? []).length === 0 ? (
          <CenterNote>No periods yet — the first posting opens one automatically.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Month</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {(periods.data ?? []).map((p) => (
                <tr key={p.period_month} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 text-charcoal-ink/80">{p.period_month}</td>
                  <td className="py-2"><Badge variant={STATUS_VARIANT[p.status] ?? "grey"}>{p.status}</Badge></td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-2">
                      {p.status !== "open" && <Button size="sm" variant="outline" onClick={() => setStatus(p.period_month, "open")}>Reopen</Button>}
                      {p.status === "open" && <Button size="sm" variant="outline" onClick={() => setStatus(p.period_month, "closed")}>Close</Button>}
                      {p.status !== "locked" && <Button size="sm" variant="outline" onClick={() => setStatus(p.period_month, "locked")}>Lock</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard
        title="Chart of accounts"
        description="The ledger's accounts. Set a revenue account's VAT treatment to 'standard' only when its sales are genuinely VATable."
      >
        {accounts.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Normal</Th>
                <Th>VAT treatment</Th>
              </tr>
            </thead>
            <tbody>
              {(accounts.data ?? []).map((a) => (
                <tr key={a.code} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 font-mono text-xs text-charcoal-ink/50">{a.code}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/80">{a.name}</td>
                  <td className="py-2 pr-4 capitalize text-charcoal-ink/60">{a.type.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{a.normal_balance}</td>
                  <td className="py-2">
                    {a.type === "revenue" ? (
                      <Select value={a.vat_treatment} onChange={(e) => setVat(a, e.target.value)} className="w-40">
                        <option value="exempt">Exempt</option>
                        <option value="standard">Standard (7.5%)</option>
                        <option value="zero_rated">Zero-rated</option>
                      </Select>
                    ) : (
                      <span className="text-charcoal-ink/40">{a.vat_treatment}</span>
                    )}
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
