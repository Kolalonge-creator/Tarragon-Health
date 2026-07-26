"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { Receipt, Landmark, Scale } from "lucide-react";
import { useTaxSummary, useTaxRates, financeKeys } from "@/lib/finance/queries";
import { upsertTaxRateAction } from "@/lib/finance/actions";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, formatPercent } from "./primitives";

const CURRENCIES = ["NGN", "GBP", "USD"];
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export function TaxConsole() {
  const qc = useQueryClient();
  const [currency, setCurrency] = useState("NGN");
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const summary = useTaxSummary(from, to, currency);
  const rates = useTaxRates();

  const netVat = (summary.data?.output_vat_minor ?? 0) - (summary.data?.input_vat_minor ?? 0);

  const [nr, setNr] = useState({ tax_type: "vat", name: "", rate_pct: "", applies_to: "", notes: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function addRate() {
    setMsg(null);
    const rate = parseFloat(nr.rate_pct);
    if (!nr.name || !Number.isFinite(rate)) return setMsg({ ok: false, text: "Name and a numeric rate are required." });
    const res = await upsertTaxRateAction({
      id: null,
      jurisdiction: "NG",
      tax_type: nr.tax_type,
      name: nr.name,
      rate_pct: rate,
      applies_to: nr.applies_to,
      effective_from: today(),
      is_active: true,
      notes: nr.notes,
    });
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save rate." });
    setMsg({ ok: true, text: "Tax rate saved." });
    setNr({ tax_type: "vat", name: "", rate_pct: "", applies_to: "", notes: "" });
    qc.invalidateQueries({ queryKey: financeKeys.all });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        VAT and WHT are read straight from the ledger&apos;s tax accounts. Most Tarragon health services
        are VAT-exempt, so output VAT stays zero until a revenue account is marked standard-rated in
        Settings. Rates below are the statutory Nigerian starting points — confirm with your tax adviser
        before filing.
      </p>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
        <div><Label>Currency</Label>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Receipt} label="Output VAT" value={formatMinor(summary.data?.output_vat_minor ?? 0, currency)} />
        <StatTile icon={Scale} label="Input VAT recoverable" value={formatMinor(summary.data?.input_vat_minor ?? 0, currency)} />
        <StatTile icon={Receipt} label="Net VAT payable" value={formatMinor(netVat, currency)} />
        <StatTile icon={Landmark} label="WHT payable" value={formatMinor(summary.data?.wht_payable_minor ?? 0, currency)} />
      </div>

      <SectionCard title="Revenue by VAT treatment" description={`${from} to ${to} · ${currency}`}>
        {summary.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (summary.data?.revenue_by_vat_treatment ?? []).length === 0 ? (
          <CenterNote>No revenue in this range.</CenterNote>
        ) : (
          <TableShell>
            <tbody>
              {(summary.data?.revenue_by_vat_treatment ?? []).map((r) => (
                <tr key={r.treatment} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 capitalize text-charcoal-ink/70">{r.treatment.replace(/_/g, " ")}</td>
                  <td className="py-2 text-right tabular-nums text-charcoal-ink">{formatMinor(r.revenue_minor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard title="Tax rates" description="Editable configuration — never hard-coded. Effective-dated.">
        {rates.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <TableShell>
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <Th>Type</Th>
                <Th>Name</Th>
                <Th right>Rate</Th>
                <Th>Applies to</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {(rates.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-4 uppercase text-charcoal-ink/60">{r.tax_type}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/80">{r.name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatPercent(r.rate_pct)}</td>
                  <td className="py-2 pr-4 text-charcoal-ink/60">{r.applies_to ?? "—"}</td>
                  <td className="py-2">{r.is_active ? <Badge variant="green">Active</Badge> : <Badge variant="grey">Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}

        <div className="mt-4 grid gap-3 border-t border-charcoal-ink/10 pt-4 sm:grid-cols-5">
          <div>
            <Label>Type</Label>
            <Select value={nr.tax_type} onChange={(e) => setNr((p) => ({ ...p, tax_type: e.target.value }))}>
              <option value="vat">VAT</option>
              <option value="wht">WHT</option>
            </Select>
          </div>
          <div><Label>Name</Label><Input value={nr.name} onChange={(e) => setNr((p) => ({ ...p, name: e.target.value }))} /></div>
          <div><Label>Rate %</Label><Input inputMode="decimal" value={nr.rate_pct} onChange={(e) => setNr((p) => ({ ...p, rate_pct: e.target.value }))} /></div>
          <div><Label>Applies to</Label><Input value={nr.applies_to} onChange={(e) => setNr((p) => ({ ...p, applies_to: e.target.value }))} placeholder="commission…" /></div>
          <div className="flex items-end"><Button className="w-full" onClick={addRate}>Add rate</Button></div>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}
      </SectionCard>
    </div>
  );
}
