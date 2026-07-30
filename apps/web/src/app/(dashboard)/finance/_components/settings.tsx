"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useFinancePeriods,
  useFinanceAccounts,
  useCostCenters,
  useApprovalSettings,
  financeKeys,
} from "@/lib/finance/queries";
import {
  setPeriodStatusAction,
  upsertAccountAction,
  upsertCostCenterAction,
  upsertApprovalThresholdAction,
} from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, majorToMinor } from "./primitives";
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
  const costCenters = useCostCenters();
  const approvalSettings = useApprovalSettings();
  const [ccMsg, setCcMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [thresholdMsg, setThresholdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  async function setStatus(month: string, status: "open" | "closed" | "locked") {
    const res = await setPeriodStatusAction(`${month}-01`, status);
    if (!res.ok) return window.alert(res.error ?? "Could not update period.");
    const resultStatus = (res.data as { status?: string } | undefined)?.status;
    if (resultStatus === "pending_approval") {
      window.alert("Locking this period requires a second finance officer's approval, sent to Approvals.");
    }
    invalidate();
  }

  const [newCc, setNewCc] = useState({ code: "", name: "" });
  async function addCostCenter() {
    setCcMsg(null);
    if (!newCc.code || !newCc.name) return setCcMsg({ ok: false, text: "Code and name are required." });
    const res = await upsertCostCenterAction({ code: newCc.code.toUpperCase(), name: newCc.name, is_active: true, sort_order: 0 });
    if (!res.ok) return setCcMsg({ ok: false, text: res.error ?? "Could not save." });
    setCcMsg({ ok: true, text: "Cost center saved." });
    setNewCc({ code: "", name: "" });
    invalidate();
  }
  async function toggleCostCenter(code: string, name: string, isActive: boolean, sortOrder: number) {
    const res = await upsertCostCenterAction({ code, name, is_active: !isActive, sort_order: sortOrder });
    if (res.ok) invalidate();
    else setCcMsg({ ok: false, text: res.error ?? "Could not update." });
  }

  async function updateThreshold(currency: string, value: string) {
    setThresholdMsg(null);
    const minor = majorToMinor(value);
    if (minor <= 0) return;
    const res = await upsertApprovalThresholdAction(currency, minor);
    if (!res.ok) return setThresholdMsg({ ok: false, text: res.error ?? "Could not save threshold." });
    setThresholdMsg({ ok: true, text: `${currency} threshold updated.` });
    invalidate();
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
          <CenterNote>No periods yet. The first posting opens one automatically.</CenterNote>
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

      <SectionCard
        title="Cost centers"
        description="Tag journal lines so P&L can be sliced by department (clinical, marketing, partner network, etc.)."
      >
        {costCenters.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Code</Th><Th>Name</Th><Th>Status</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {(costCenters.data ?? []).map((c) => (
                <tr key={c.code} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 font-mono text-xs text-charcoal-ink/50">{c.code}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/80">{c.name}</td>
                  <td className="py-2">{c.is_active ? <Badge variant="green">Active</Badge> : <Badge variant="grey">Inactive</Badge>}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-charcoal-ink/50 hover:text-brand-green"
                      onClick={() => toggleCostCenter(c.code, c.name, c.is_active, c.sort_order)}
                    >
                      {c.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <div className="mt-4 grid gap-3 border-t border-charcoal-ink/10 pt-4 sm:grid-cols-3">
          <div><Label>Code</Label><Input value={newCc.code} onChange={(e) => setNewCc((p) => ({ ...p, code: e.target.value }))} placeholder="e.g. LEGAL" /></div>
          <div><Label>Name</Label><Input value={newCc.name} onChange={(e) => setNewCc((p) => ({ ...p, name: e.target.value }))} /></div>
          <div className="flex items-end"><Button className="w-full" onClick={addCostCenter}>Add cost center</Button></div>
        </div>
        {ccMsg && <p className={`mt-2 text-sm ${ccMsg.ok ? "text-brand-green" : "text-red-600"}`}>{ccMsg.text}</p>}
      </SectionCard>

      <SectionCard
        title="Approval threshold"
        description="A manual journal entry with any line at or above this amount goes to a second finance officer for approval instead of posting immediately."
      >
        {approvalSettings.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {(approvalSettings.data ?? []).map((s) => (
              <div key={s.currency}>
                <Label>{s.currency}</Label>
                <Input
                  inputMode="decimal"
                  defaultValue={(s.threshold_minor / 100).toString()}
                  onBlur={(e) => updateThreshold(s.currency, e.target.value)}
                />
                <p className="mt-1 text-xs text-charcoal-ink/40">Currently {formatMinor(s.threshold_minor, s.currency)}</p>
              </div>
            ))}
          </div>
        )}
        {thresholdMsg && <p className={`mt-2 text-sm ${thresholdMsg.ok ? "text-brand-green" : "text-red-600"}`}>{thresholdMsg.text}</p>}
      </SectionCard>
    </div>
  );
}
