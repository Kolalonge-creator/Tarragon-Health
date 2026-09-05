"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { refreshQueryState } from "@/lib/queries/list-query-state";
import { Receipt, Landmark, Scale } from "lucide-react";
import { useTaxSummary, useTaxRates, financeKeys } from "@/lib/finance/queries";
import { upsertTaxRateAction } from "@/lib/finance/actions";
import { lagosToday, lagosYearStart } from "@/lib/format-date";
import { SectionCard, CenterNote, TableShell, Th, formatMinor, formatPercent } from "./primitives";

const CURRENCIES = ["NGN", "GBP", "USD"];

export function TaxConsole() {
  const qc = useQueryClient();
  const [currency, setCurrency] = useState("NGN");
  const [from, setFrom] = useState(lagosYearStart());
  const [to, setTo] = useState(lagosToday());
  const summary = useTaxSummary(from, to, currency);
  const rates = useTaxRates();

  const netVat = (summary.data?.output_vat_minor ?? 0) - (summary.data?.input_vat_minor ?? 0);

  // "Net VAT payable ₦0.00" is a statutory figure, and the `?? 0` above is
  // what turned a failed RPC into one. Filing on a zero this page invented is
  // a different class of mistake from misreading a dashboard, so the tiles are
  // replaced outright rather than softened; a stale-but-real reading is still
  // worth showing, which is what the amber notice covers.
  const summaryState = refreshQueryState({
    isLoading: summary.isLoading,
    isError: summary.isError,
    hasData: summary.data !== undefined,
  });
  const ratesState = refreshQueryState({
    isLoading: rates.isLoading,
    isError: rates.isError,
    hasData: rates.data !== undefined,
  });

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
      effective_from: lagosToday(),
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
        Settings. Rates below are the statutory Nigerian starting points; confirm with your tax adviser
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

      {summaryState === "stale" && (
        <StaleDataNotice>
          These tax figures could not be refreshed just now. They are the last ones we read
          successfully for this period and currency, not a current position. Reload before filing
          anything from them.
        </StaleDataNotice>
      )}

      {summaryState === "failed" ? (
        <LoadFailure>
          The tax summary could not be loaded, so output VAT, input VAT, net VAT payable and WHT
          payable are all unknown rather than zero. Do not file or pay from this screen until it
          loads. Reload to try again.
        </LoadFailure>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={Receipt} label="Output VAT" value={formatMinor(summary.data?.output_vat_minor ?? 0, currency)} />
          <StatTile icon={Scale} label="Input VAT recoverable" value={formatMinor(summary.data?.input_vat_minor ?? 0, currency)} />
          <StatTile icon={Receipt} label="Net VAT payable" value={formatMinor(netVat, currency)} />
          <StatTile icon={Landmark} label="WHT payable" value={formatMinor(summary.data?.wht_payable_minor ?? 0, currency)} />
        </div>
      )}

      <SectionCard title="Revenue by VAT treatment" description={`${from} to ${to} · ${currency}`}>
        {summaryState === "failed" ? (
          <LoadFailure>
            Revenue by VAT treatment could not be loaded. This is not a report that there was no
            revenue in this range.
          </LoadFailure>
        ) : summary.isLoading ? (
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

      <SectionCard title="Tax rates" description="Editable configuration, never hard-coded. Effective-dated.">
        {/* An empty rate table reads as "no VAT or WHT rate is configured",
            which invites someone to add a duplicate of one that already
            exists and is merely unread. */}
        {ratesState === "failed" ? (
          <LoadFailure>
            The configured tax rates could not be loaded. Do not add a rate from this screen until
            it does: an existing rate may already be in place and simply unread.
          </LoadFailure>
        ) : rates.isLoading ? (
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
