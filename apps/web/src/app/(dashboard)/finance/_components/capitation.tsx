"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useCapitationRegister,
  useHmoOrganisations,
  financeKeys,
} from "@/lib/finance/queries";
import { upsertCapitationContractAction, recordCapitationReceiptAction } from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, majorToMinor } from "./primitives";

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function CapitationRegister() {
  const qc = useQueryClient();
  const register = useCapitationRegister();
  const orgs = useHmoOrganisations();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  const [showContractForm, setShowContractForm] = useState(false);
  const [cf, setCf] = useState({ organisation_id: "", contract_name: "", pmpm_rate: "", currency: "NGN" });
  async function saveContract() {
    setMsg(null);
    if (!cf.organisation_id || !cf.contract_name || !cf.pmpm_rate) {
      return setMsg({ ok: false, text: "HMO, contract name and PMPM rate are required." });
    }
    const res = await upsertCapitationContractAction({
      id: null,
      organisation_id: cf.organisation_id,
      contract_name: cf.contract_name,
      pmpm_rate_minor: majorToMinor(cf.pmpm_rate),
      currency: cf.currency,
      effective_from: today(),
      is_active: true,
    });
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save contract." });
    setMsg({ ok: true, text: "Contract saved." });
    setCf({ organisation_id: "", contract_name: "", pmpm_rate: "", currency: "NGN" });
    setShowContractForm(false);
    invalidate();
  }

  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [rf, setRf] = useState({ period_month: thisMonth(), enrolled_members: "", amount: "", cost_of_care: "" });
  async function saveReceipt(contractId: string, bankAccountCode: string) {
    setMsg(null);
    if (!rf.enrolled_members || !rf.amount) {
      return setMsg({ ok: false, text: "Enrolled members and amount received are required." });
    }
    const res = await recordCapitationReceiptAction({
      contract_id: contractId,
      period_month: `${rf.period_month}-01`,
      enrolled_members: parseInt(rf.enrolled_members, 10),
      amount_minor: majorToMinor(rf.amount),
      received_date: today(),
      bank_account_code: bankAccountCode,
      estimated_cost_of_care_minor: rf.cost_of_care ? majorToMinor(rf.cost_of_care) : undefined,
    });
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not record receipt." });
    setMsg({ ok: true, text: "Receipt posted to the ledger." });
    setReceiptFor(null);
    setRf({ period_month: thisMonth(), enrolled_members: "", amount: "", cost_of_care: "" });
    invalidate();
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        HMO capitation (a fixed per-member-per-month rate) is booked distinctly from fee-for-service
        revenue. &quot;Estimated cost of care&quot; and the loss-ratio figure below are a manually-entered
        estimate for renewal conversations — Tarragon has no claims ledger, so this is never a real claims
        feed. &quot;Tarragon-side roster&quot; is the count of patients who&apos;ve actually claimed a
        Tarragon account under that HMO — it will typically differ from the HMO&apos;s own billed headcount.
      </p>

      {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}

      <SectionCard
        title="Capitation contracts"
        description="One row per HMO deal."
        actions={
          <Button size="sm" variant={showContractForm ? "outline" : "default"} onClick={() => setShowContractForm((s) => !s)}>
            {showContractForm ? "Hide" : "New contract"}
          </Button>
        }
      >
        {showContractForm && (
          <div className="mb-4 grid gap-3 rounded-lg border border-charcoal-ink/10 p-3 sm:grid-cols-4">
            <div>
              <Label>HMO partner</Label>
              <Select value={cf.organisation_id} onChange={(e) => setCf((p) => ({ ...p, organisation_id: e.target.value }))}>
                <option value="">Select…</option>
                {(orgs.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Contract name</Label>
              <Input value={cf.contract_name} onChange={(e) => setCf((p) => ({ ...p, contract_name: e.target.value }))} />
            </div>
            <div>
              <Label>PMPM rate</Label>
              <Input inputMode="decimal" value={cf.pmpm_rate} onChange={(e) => setCf((p) => ({ ...p, pmpm_rate: e.target.value }))} />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={cf.currency} onChange={(e) => setCf((p) => ({ ...p, currency: e.target.value }))}>
                <option value="NGN">NGN</option>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
              </Select>
            </div>
            <div className="sm:col-span-4 flex justify-end">
              <Button size="sm" onClick={saveContract}>Save contract</Button>
            </div>
          </div>
        )}

        {register.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (register.data ?? []).length === 0 ? (
          <CenterNote>No capitation contracts yet.</CenterNote>
        ) : (
          <div className="space-y-4">
            {(register.data ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border border-charcoal-ink/10">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-charcoal-ink/5 bg-warm-ivory/40 px-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium text-charcoal-ink">{c.organisation_name}</span>
                    <span className="text-charcoal-ink/60"> · {c.contract_name}</span>
                    <span className="ml-2 text-charcoal-ink/50">
                      PMPM {formatMinor(c.pmpm_rate_minor, c.currency)}
                    </span>
                    {!c.is_active && <Badge variant="grey">Inactive</Badge>}
                  </div>
                  <span className="text-xs text-charcoal-ink/50">
                    Tarragon-side roster: {c.roster_active_members}
                  </span>
                </div>
                <div className="p-3">
                  {receiptFor === c.id ? (
                    <div className="mb-3 grid gap-3 sm:grid-cols-5">
                      <div>
                        <Label>Period</Label>
                        <Input type="month" value={rf.period_month} onChange={(e) => setRf((p) => ({ ...p, period_month: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Enrolled members</Label>
                        <Input inputMode="numeric" value={rf.enrolled_members} onChange={(e) => setRf((p) => ({ ...p, enrolled_members: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Amount received</Label>
                        <Input inputMode="decimal" value={rf.amount} onChange={(e) => setRf((p) => ({ ...p, amount: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Est. cost of care (optional)</Label>
                        <Input inputMode="decimal" value={rf.cost_of_care} onChange={(e) => setRf((p) => ({ ...p, cost_of_care: e.target.value }))} />
                      </div>
                      <div className="flex items-end gap-2">
                        <Button size="sm" onClick={() => saveReceipt(c.id, "1000")}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setReceiptFor(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReceiptFor(c.id);
                          setRf((p) => ({
                            ...p,
                            enrolled_members: c.roster_active_members > 0 ? String(c.roster_active_members) : "",
                          }));
                        }}
                      >
                        Record a receipt
                      </Button>
                    </div>
                  )}

                  {c.receipts.length === 0 ? (
                    <CenterNote>No receipts recorded yet.</CenterNote>
                  ) : (
                    <TableShell>
                      <thead>
                        <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                          <Th>Period</Th>
                          <Th right>Members</Th>
                          <Th right>Received</Th>
                          <Th right>Implied PMPM</Th>
                          <Th right>Rate variance</Th>
                          <Th right>Est. loss ratio</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.receipts.map((r) => (
                          <tr key={r.id} className="border-b border-charcoal-ink/5">
                            <td className="py-1.5 pr-4 text-charcoal-ink/70">{r.period_month}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums">{r.enrolled_members}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums">{formatMinor(r.amount_minor, c.currency)}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums">
                              {r.implied_pmpm_minor != null ? formatMinor(r.implied_pmpm_minor, c.currency) : "—"}
                            </td>
                            <td className={`py-1.5 pr-4 text-right tabular-nums ${(r.rate_variance_minor ?? 0) < 0 ? "text-red-600" : "text-charcoal-ink"}`}>
                              {r.rate_variance_minor != null ? formatMinor(r.rate_variance_minor, c.currency) : "—"}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {r.estimated_loss_ratio_pct != null ? `${r.estimated_loss_ratio_pct}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </TableShell>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
