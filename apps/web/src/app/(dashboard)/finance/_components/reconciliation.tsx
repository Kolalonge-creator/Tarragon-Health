"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useReconciliationSummary, useReconciliationFlags, financeKeys } from "@/lib/finance/queries";
import type { ReconciliationFlag } from "@/lib/finance/schemas";
import {
  importSettlementAction,
  matchPaymentAction,
  postSettlementAction,
  resolveReconciliationFlagAction,
} from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, majorToMinor } from "./primitives";

const PROVIDERS = ["paystack", "stripe"];
const CURRENCIES = ["NGN", "GBP", "USD"];
const BANKS = [
  { code: "1000", label: "Bank: Paystack (NGN)" },
  { code: "1010", label: "Bank: Stripe (diaspora)" },
];
const today = () => new Date().toISOString().slice(0, 10);

export function Reconciliation() {
  const qc = useQueryClient();
  const { data, isLoading } = useReconciliationSummary();
  const { data: flags, isLoading: flagsLoading } = useReconciliationFlags("open");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  async function resolveFlag(id: string, status: "resolved" | "ignored") {
    const res = await resolveReconciliationFlagAction(id, status);
    if (res.ok) {
      setMsg({ ok: true, text: status === "resolved" ? "Flag marked resolved." : "Flag ignored." });
      invalidate();
    } else {
      setMsg({ ok: false, text: res.error ?? "Could not update the flag." });
    }
  }

  // import form
  const [f, setF] = useState({
    provider: "paystack",
    external_ref: "",
    settlement_date: today(),
    currency: "NGN",
    gross: "",
    fees: "",
    net: "",
    bank: "1000",
    notes: "",
  });
  const variance = useMemo(
    () => majorToMinor(f.gross) - majorToMinor(f.net) - majorToMinor(f.fees),
    [f.gross, f.net, f.fees],
  );
  const [saving, setSaving] = useState(false);

  async function importSettlement() {
    setSaving(true);
    setMsg(null);
    const res = await importSettlementAction({
      provider: f.provider,
      external_ref: f.external_ref,
      settlement_date: f.settlement_date,
      currency: f.currency,
      gross_minor: majorToMinor(f.gross),
      fees_minor: majorToMinor(f.fees),
      net_minor: majorToMinor(f.net),
      bank_account_code: f.bank,
      notes: f.notes,
    });
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not import settlement." });
    setMsg({ ok: true, text: "Settlement imported. Match its payments, then post." });
    setF((p) => ({ ...p, external_ref: "", gross: "", fees: "", net: "", notes: "" }));
    invalidate();
  }

  const drafts = (data?.settlements ?? []).filter((s) => s.status === "draft");

  async function post(id: string) {
    const res = await postSettlementAction(id);
    if (res.ok) {
      setMsg({ ok: true, text: "Settlement posted to the ledger." });
      invalidate();
    } else {
      setMsg({ ok: false, text: res.error ?? "Could not post settlement." });
    }
  }

  async function match(settlementId: string, txnId: string, amountMinor: number) {
    if (!settlementId) return;
    const res = await matchPaymentAction(settlementId, txnId, amountMinor);
    if (res.ok) invalidate();
    else setMsg({ ok: false, text: res.error ?? "Could not match payment." });
  }

  return (
    <div className="space-y-6">
      {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}

      <SectionCard
        title="Automated reconciliation flags"
        description="Daily sweep against Paystack's and Stripe's own transaction records; detection only, nothing here is fixed automatically."
      >
        {flagsLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (flags ?? []).length === 0 ? (
          <CenterNote>No open flags. Everything the sweep checked in the last window matched. ✓</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Detected</Th>
                <Th>Provider</Th>
                <Th>Issue</Th>
                <Th>Reference</Th>
                <Th right>Local</Th>
                <Th right>Provider</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {(flags ?? []).map((f) => (
                <FlagRow key={f.id} flag={f} onResolve={resolveFlag} />
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard
        title="Import a settlement"
        description="Enter a provider payout batch (gross / fees / net). Posting requires gross = net + fees."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Provider</Label>
            <Select value={f.provider} onChange={(e) => setF((p) => ({ ...p, provider: e.target.value, bank: e.target.value === "stripe" ? "1010" : "1000" }))}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div>
            <Label>Settlement date</Label>
            <Input type="date" value={f.settlement_date} onChange={(e) => setF((p) => ({ ...p, settlement_date: e.target.value }))} />
          </div>
          <div>
            <Label>Currency</Label>
            <Select value={f.currency} onChange={(e) => setF((p) => ({ ...p, currency: e.target.value }))}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div>
            <Label>Provider reference</Label>
            <Input value={f.external_ref} onChange={(e) => setF((p) => ({ ...p, external_ref: e.target.value }))} placeholder="e.g. STL_xxx" />
          </div>
          <div>
            <Label>Bank account</Label>
            <Select value={f.bank} onChange={(e) => setF((p) => ({ ...p, bank: e.target.value }))}>
              {BANKS.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <div>
            <Label>Gross</Label>
            <Input inputMode="decimal" className="text-right" value={f.gross} onChange={(e) => setF((p) => ({ ...p, gross: e.target.value }))} placeholder="0" />
          </div>
          <div>
            <Label>Fees</Label>
            <Input inputMode="decimal" className="text-right" value={f.fees} onChange={(e) => setF((p) => ({ ...p, fees: e.target.value }))} placeholder="0" />
          </div>
          <div>
            <Label>Net paid out</Label>
            <Input inputMode="decimal" className="text-right" value={f.net} onChange={(e) => setF((p) => ({ ...p, net: e.target.value }))} placeholder="0" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm">
            Variance:{" "}
            <b className={variance === 0 ? "text-brand-green" : "text-red-600"}>{formatMinor(variance, f.currency)}</b>
            {variance !== 0 && <span className="ml-1 text-xs text-charcoal-ink/50">(gross must equal net + fees to post)</span>}
          </span>
          <Button size="sm" onClick={importSettlement} disabled={saving}>{saving ? "Saving…" : "Import settlement"}</Button>
        </div>
      </SectionCard>

      <SectionCard title="Settlements" description="Imported payout batches. Post a draft to move clearing → bank and expense the fee.">
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (data?.settlements ?? []).length === 0 ? (
          <CenterNote>No settlements imported yet.</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Date</Th>
                <Th>Provider</Th>
                <Th right>Gross</Th>
                <Th right>Fees</Th>
                <Th right>Net</Th>
                <Th right>Matched</Th>
                <Th>Status</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {(data?.settlements ?? []).map((s) => (
                <tr key={s.id} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 text-charcoal-ink/60">{s.settlement_date}</td>
                  <td className="py-2 pr-4 capitalize text-charcoal-ink/70">{s.provider}{s.external_ref ? ` · ${s.external_ref}` : ""}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(s.gross_minor, s.currency)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(s.fees_minor, s.currency)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(s.net_minor, s.currency)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{s.matched_count}</td>
                  <td className="py-2">
                    <Badge variant={s.status === "reconciled" ? "green" : "amber"}>{s.status}</Badge>
                    {s.variance_minor !== 0 && <Badge variant="grey">variance</Badge>}
                  </td>
                  <td className="py-2 text-right">
                    {s.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => post(s.id)}>Post</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard title="Unmatched captured payments" description="Card charges captured but not yet tied to a settlement payout.">
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (data?.unmatched ?? []).length === 0 ? (
          <CenterNote>Everything captured is matched. ✓</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Processed</Th>
                <Th>Provider</Th>
                <Th>Reference</Th>
                <Th right>Amount</Th>
                <Th>Match to settlement</Th>
              </tr>
            </thead>
            <tbody>
              {(data?.unmatched ?? []).map((p) => (
                <UnmatchedRow key={p.id} payment={p} drafts={drafts} onMatch={match} />
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>
    </div>
  );
}

const FLAG_TYPE_LABEL: Record<string, string> = {
  missing_locally: "Missing locally: webhook may not have fired",
  amount_mismatch: "Amount mismatch",
  status_mismatch: "Status mismatch",
};

function FlagRow({
  flag,
  onResolve,
}: {
  flag: ReconciliationFlag;
  onResolve: (id: string, status: "resolved" | "ignored") => void;
}) {
  const currency = flag.currency ?? "NGN";
  return (
    <tr className="border-b border-charcoal-ink/5">
      <td className="py-2 pr-4 text-charcoal-ink/60">{flag.detected_at.slice(0, 10)}</td>
      <td className="py-2 pr-4 capitalize text-charcoal-ink/70">{flag.provider}</td>
      <td className="py-2 pr-4">
        <Badge variant={flag.flag_type === "missing_locally" ? "red" : "amber"}>
          {FLAG_TYPE_LABEL[flag.flag_type] ?? flag.flag_type}
        </Badge>
      </td>
      <td className="py-2 pr-4 font-mono text-xs text-charcoal-ink/50">{flag.provider_reference.slice(0, 22)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {flag.local_amount_minor != null ? formatMinor(flag.local_amount_minor, currency) : "—"}
        {flag.local_status && <div className="text-xs text-charcoal-ink/40">{flag.local_status}</div>}
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {flag.provider_amount_minor != null ? formatMinor(flag.provider_amount_minor, currency) : "—"}
        {flag.provider_status && <div className="text-xs text-charcoal-ink/40">{flag.provider_status}</div>}
      </td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onResolve(flag.id, "resolved")}>Resolved</Button>
          <Button size="sm" variant="outline" onClick={() => onResolve(flag.id, "ignored")}>Ignore</Button>
        </div>
      </td>
    </tr>
  );
}

function UnmatchedRow({
  payment,
  drafts,
  onMatch,
}: {
  payment: { id: string; provider: string; event_type: string; amount_minor: number; currency: string | null; processed_at: string | null; reference: string | null };
  drafts: { id: string; provider: string; settlement_date: string; currency: string }[];
  onMatch: (settlementId: string, txnId: string, amountMinor: number) => void;
}) {
  const [sel, setSel] = useState("");
  const eligible = drafts.filter((d) => d.currency === (payment.currency ?? "NGN"));
  return (
    <tr className="border-b border-charcoal-ink/5">
      <td className="py-2 pr-4 text-charcoal-ink/60">{payment.processed_at?.slice(0, 10) ?? "—"}</td>
      <td className="py-2 pr-4 capitalize text-charcoal-ink/70">{payment.provider}</td>
      <td className="py-2 pr-4 font-mono text-xs text-charcoal-ink/50">{payment.reference?.slice(0, 22) ?? "—"}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(payment.amount_minor, payment.currency ?? "NGN")}</td>
      <td className="py-2">
        <div className="flex items-center gap-2">
          <Select value={sel} onChange={(e) => setSel(e.target.value)} className="w-auto">
            <option value="">Select…</option>
            {eligible.map((d) => (
              <option key={d.id} value={d.id}>{d.provider} · {d.settlement_date}</option>
            ))}
          </Select>
          <Button size="sm" variant="outline" disabled={!sel} onClick={() => onMatch(sel, payment.id, payment.amount_minor)}>
            Match
          </Button>
        </div>
      </td>
    </tr>
  );
}
