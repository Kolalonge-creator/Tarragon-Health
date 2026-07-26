"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useVendors,
  useBills,
  useApAging,
  useFinanceAccounts,
  financeKeys,
} from "@/lib/finance/queries";
import {
  upsertVendorAction,
  createBillAction,
  approveBillAction,
  payBillAction,
  voidBillAction,
} from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, majorToMinor } from "./primitives";

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_VARIANT: Record<string, "grey" | "amber" | "green" | "red"> = {
  draft: "grey",
  approved: "amber",
  paid: "green",
  void: "red",
};

export function PayablesAndVendors() {
  const qc = useQueryClient();
  const vendors = useVendors();
  const bills = useBills();
  const aging = useApAging();
  const accounts = useFinanceAccounts();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });
  const expenseAccounts = (accounts.data ?? []).filter((a) => a.type === "expense");

  const [showVendorForm, setShowVendorForm] = useState(false);
  const [vf, setVf] = useState({ name: "", vendor_type: "", wht_applicable: false, wht_rate_pct: "" });
  async function saveVendor() {
    setMsg(null);
    if (!vf.name) return setMsg({ ok: false, text: "Vendor name is required." });
    const res = await upsertVendorAction({
      id: null,
      name: vf.name,
      vendor_type: vf.vendor_type,
      contact_email: "",
      contact_phone: "",
      tin: "",
      wht_applicable: vf.wht_applicable,
      wht_rate_pct: vf.wht_applicable && vf.wht_rate_pct ? parseFloat(vf.wht_rate_pct) : null,
      is_active: true,
    });
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save vendor." });
    setMsg({ ok: true, text: "Vendor saved." });
    setVf({ name: "", vendor_type: "", wht_applicable: false, wht_rate_pct: "" });
    setShowVendorForm(false);
    invalidate();
  }

  const [showBillForm, setShowBillForm] = useState(false);
  const [bf, setBf] = useState({
    vendor_id: "",
    bill_date: today(),
    due_date: "",
    currency: "NGN",
    amount: "",
    expense_account_code: "",
    description: "",
  });
  async function saveBill() {
    setMsg(null);
    if (!bf.vendor_id || !bf.amount || !bf.expense_account_code) {
      return setMsg({ ok: false, text: "Vendor, amount and expense account are required." });
    }
    const res = await createBillAction({
      vendor_id: bf.vendor_id,
      bill_date: bf.bill_date,
      due_date: bf.due_date || undefined,
      currency: bf.currency,
      amount_minor: majorToMinor(bf.amount),
      expense_account_code: bf.expense_account_code,
      description: bf.description,
    });
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not create bill." });
    setMsg({ ok: true, text: "Bill created as a draft." });
    setBf({ vendor_id: "", bill_date: today(), due_date: "", currency: "NGN", amount: "", expense_account_code: "", description: "" });
    setShowBillForm(false);
    invalidate();
  }

  async function approve(id: string) {
    const res = await approveBillAction(id);
    if (res.ok) { setMsg({ ok: true, text: "Bill approved and posted." }); invalidate(); }
    else setMsg({ ok: false, text: res.error ?? "Could not approve." });
  }
  async function pay(id: string) {
    const res = await payBillAction(id, "1000", today());
    if (res.ok) { setMsg({ ok: true, text: "Bill paid and posted." }); invalidate(); }
    else setMsg({ ok: false, text: res.error ?? "Could not mark paid." });
  }
  async function voidDraft(id: string) {
    const reason = window.prompt("Reason for voiding?") ?? "";
    if (!reason) return;
    const res = await voidBillAction(id, reason);
    if (res.ok) { setMsg({ ok: true, text: "Bill voided." }); invalidate(); }
    else setMsg({ ok: false, text: res.error ?? "Could not void." });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Accounts payable for operating spend that isn&apos;t already automated — rent, SaaS, marketing
        agencies, indemnity cover, professional/legal fees. A bill moves draft → approved (books the
        expense + payable, withholding tax if the vendor is WHT-applicable) → paid (books the cash out).
        Correct an approved/paid bill by reversing its journal entry on the ledger, never by editing it.
      </p>

      {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}

      <SectionCard
        title="Vendors"
        actions={
          <Button size="sm" variant={showVendorForm ? "outline" : "default"} onClick={() => setShowVendorForm((s) => !s)}>
            {showVendorForm ? "Hide" : "New vendor"}
          </Button>
        }
      >
        {showVendorForm && (
          <div className="mb-4 grid gap-3 rounded-lg border border-charcoal-ink/10 p-3 sm:grid-cols-4">
            <div>
              <Label>Name</Label>
              <Input value={vf.name} onChange={(e) => setVf((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label>Type</Label>
              <Input value={vf.vendor_type} onChange={(e) => setVf((p) => ({ ...p, vendor_type: e.target.value }))} placeholder="e.g. professional_services" />
            </div>
            <div className="flex items-end gap-2">
              <input
                id="wht-app"
                type="checkbox"
                checked={vf.wht_applicable}
                onChange={(e) => setVf((p) => ({ ...p, wht_applicable: e.target.checked }))}
              />
              <Label htmlFor="wht-app">WHT applicable</Label>
            </div>
            {vf.wht_applicable && (
              <div>
                <Label>WHT rate %</Label>
                <Input inputMode="decimal" value={vf.wht_rate_pct} onChange={(e) => setVf((p) => ({ ...p, wht_rate_pct: e.target.value }))} />
              </div>
            )}
            <div className="sm:col-span-4 flex justify-end">
              <Button size="sm" onClick={saveVendor}>Save vendor</Button>
            </div>
          </div>
        )}
        {vendors.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (vendors.data ?? []).length === 0 ? (
          <CenterNote>No vendors yet.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Name</Th><Th>Type</Th><Th>WHT</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {(vendors.data ?? []).map((v) => (
                <tr key={v.id} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 text-charcoal-ink/80">{v.name}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{v.vendor_type ?? "—"}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">
                    {v.wht_applicable ? `${v.wht_rate_pct ?? 0}%` : "—"}
                  </td>
                  <td className="py-2">
                    {v.is_active ? <Badge variant="green">Active</Badge> : <Badge variant="grey">Inactive</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard
        title="Bills"
        actions={
          <Button size="sm" variant={showBillForm ? "outline" : "default"} onClick={() => setShowBillForm((s) => !s)}>
            {showBillForm ? "Hide" : "New bill"}
          </Button>
        }
      >
        {showBillForm && (
          <div className="mb-4 grid gap-3 rounded-lg border border-charcoal-ink/10 p-3 sm:grid-cols-3">
            <div>
              <Label>Vendor</Label>
              <Select value={bf.vendor_id} onChange={(e) => setBf((p) => ({ ...p, vendor_id: e.target.value }))}>
                <option value="">Select…</option>
                {(vendors.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Bill date</Label>
              <Input type="date" value={bf.bill_date} onChange={(e) => setBf((p) => ({ ...p, bill_date: e.target.value }))} />
            </div>
            <div>
              <Label>Due date</Label>
              <Input type="date" value={bf.due_date} onChange={(e) => setBf((p) => ({ ...p, due_date: e.target.value }))} />
            </div>
            <div>
              <Label>Amount</Label>
              <Input inputMode="decimal" value={bf.amount} onChange={(e) => setBf((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Expense account</Label>
              <Select value={bf.expense_account_code} onChange={(e) => setBf((p) => ({ ...p, expense_account_code: e.target.value }))}>
                <option value="">Select…</option>
                {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={bf.description} onChange={(e) => setBf((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <Button size="sm" onClick={saveBill}>Save as draft</Button>
            </div>
          </div>
        )}
        {bills.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (bills.data ?? []).length === 0 ? (
          <CenterNote>No bills yet.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>#</Th><Th>Vendor</Th><Th>Date</Th><Th right>Amount</Th><Th right>WHT</Th><Th>Status</Th><Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {(bills.data ?? []).map((b) => (
                <tr key={b.id} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 font-mono text-xs text-charcoal-ink/50">#{b.bill_no}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/80">{b.vendor_name}{b.description ? ` · ${b.description}` : ""}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{b.bill_date}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(b.amount_minor, b.currency)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{b.wht_minor ? formatMinor(b.wht_minor, b.currency) : "—"}</td>
                  <td className="py-2"><Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge></td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-2">
                      {b.status === "draft" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => approve(b.id)}>Approve</Button>
                          <button type="button" className="text-xs text-charcoal-ink/50 hover:text-red-600" onClick={() => voidDraft(b.id)}>Void</button>
                        </>
                      )}
                      {b.status === "approved" && (
                        <Button size="sm" variant="outline" onClick={() => pay(b.id)}>Mark paid</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard title="AP aging" description="Approved, unpaid bills — days past due.">
        {aging.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (aging.data ?? []).length === 0 ? (
          <CenterNote>No outstanding payables. ✓</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>#</Th><Th>Vendor</Th><Th right>Amount due</Th><Th>Due date</Th><Th right>Days overdue</Th>
              </tr>
            </thead>
            <tbody>
              {(aging.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 font-mono text-xs text-charcoal-ink/50">#{r.bill_no}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/80">{r.vendor_name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(r.amount_minor, r.currency)}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{r.due_date ?? "—"}</td>
                  <td className="py-2 text-right">
                    {r.days_overdue > 0 ? <Badge variant="red">{r.days_overdue}d</Badge> : <span className="text-charcoal-ink/40">on time</span>}
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
