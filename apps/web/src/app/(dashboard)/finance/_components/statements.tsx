"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useTrialBalance, useIncomeStatement, useBalanceSheet, useCashFlowStatement } from "@/lib/finance/queries";
import { lagosToday, lagosYearStart } from "@/lib/format-date";
import { SectionCard, CenterNote, TableShell, Th, formatMinor } from "./primitives";

const CURRENCIES = ["NGN", "GBP", "USD"];

const TYPE_LABEL: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  contra_revenue: "Contra-revenue",
  expense: "Expenses",
};

export function FinanceStatements() {
  const [currency, setCurrency] = useState("NGN");
  const [asOf, setAsOf] = useState(lagosToday());
  const [from, setFrom] = useState(lagosYearStart());
  const [to, setTo] = useState(lagosToday());

  const tb = useTrialBalance(asOf, currency);
  const pnl = useIncomeStatement(from, to, currency);
  const bs = useBalanceSheet(asOf, currency);
  const cf = useCashFlowStatement(from, to, currency);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
        <div>
          <Label htmlFor="st-cur">Currency</Label>
          <Select id="st-cur" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="st-from">P&amp;L from</Label>
          <Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
        </div>
        <div>
          <Label htmlFor="st-to">P&amp;L to</Label>
          <Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
        </div>
        <div>
          <Label htmlFor="st-asof">As of (TB / BS)</Label>
          <Input id="st-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-auto" />
        </div>
      </div>

      <SectionCard title="Income statement (P&L)" description={`${from} to ${to} · ${currency}`}>
        {pnl.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <>
            <TableShell>
              <tbody>
                {(pnl.data?.lines ?? []).map((l) => (
                  <tr key={l.code} className="border-b border-charcoal-ink/5">
                    <td className="py-1.5 pr-4 text-charcoal-ink/70">
                      <span className="font-mono text-xs text-charcoal-ink/40">{l.code}</span> {l.name}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-charcoal-ink">
                      {formatMinor(l.amount_minor, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <dl className="mt-4 space-y-1.5 border-t border-charcoal-ink/10 pt-3 text-sm">
              <Row label="Net revenue" value={formatMinor(pnl.data?.net_revenue_minor ?? 0, currency)} />
              <Row label="Expenses" value={formatMinor(pnl.data?.expense_minor ?? 0, currency)} />
              <Row label="Net income" value={formatMinor(pnl.data?.net_income_minor ?? 0, currency)} strong />
            </dl>
          </>
        )}
      </SectionCard>

      <SectionCard title="Cash flow statement (indirect method)" description={`${from} to ${to} · ${currency}`}>
        {cf.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <div className="space-y-4">
            <CashFlowSection title="Operating activities" section={cf.data?.operating} netLabel="Net cash from operating" currency={currency} />
            <CashFlowSection title="Investing activities" section={cf.data?.investing} netLabel="Net cash from investing" currency={currency} />
            <CashFlowSection title="Financing activities" section={cf.data?.financing} netLabel="Net cash from financing" currency={currency} />
            <dl className="space-y-1.5 border-t border-charcoal-ink/10 pt-3 text-sm">
              <Row label="Net change in cash" value={formatMinor(cf.data?.net_change_in_cash_minor ?? 0, currency)} />
              <Row label="Cash, beginning of period" value={formatMinor(cf.data?.cash_beginning_minor ?? 0, currency)} />
              <Row label="Cash, end of period" value={formatMinor(cf.data?.cash_ending_minor ?? 0, currency)} strong />
            </dl>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Balance sheet"
          description={`As of ${asOf} · ${currency}`}
          actions={bs.data ? (bs.data.balances ? <Badge variant="green">Balanced</Badge> : <Badge variant="amber">Unbalanced</Badge>) : undefined}
        >
          {bs.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (
            <>
              <StatementByType accounts={bs.data?.accounts ?? []} currency={currency} types={["asset", "liability", "equity"]} />
              <dl className="mt-4 space-y-1.5 border-t border-charcoal-ink/10 pt-3 text-sm">
                <Row label="Total assets" value={formatMinor(bs.data?.assets_minor ?? 0, currency)} />
                <Row label="Total liabilities" value={formatMinor(bs.data?.liabilities_minor ?? 0, currency)} />
                <Row label="Retained earnings (net income)" value={formatMinor(bs.data?.retained_earnings_minor ?? 0, currency)} />
                <Row label="Total equity" value={formatMinor(bs.data?.total_equity_minor ?? 0, currency)} strong />
              </dl>
            </>
          )}
        </SectionCard>

        <SectionCard title="Trial balance" description={`As of ${asOf} · ${currency}`}>
          {tb.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (tb.data ?? []).length === 0 ? (
            <CenterNote>No ledger activity.</CenterNote>
          ) : (
            <TableShell>
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                  <Th>Account</Th>
                  <Th right>Debit</Th>
                  <Th right>Credit</Th>
                </tr>
              </thead>
              <tbody>
                {(tb.data ?? []).map((r) => (
                  <tr key={r.code} className="border-b border-charcoal-ink/5">
                    <td className="py-1.5 pr-4 text-charcoal-ink/70">
                      <span className="font-mono text-xs text-charcoal-ink/40">{r.code}</span> {r.name}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{r.debit_minor ? formatMinor(r.debit_minor, currency) : ""}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.credit_minor ? formatMinor(r.credit_minor, currency) : ""}</td>
                  </tr>
                ))}
                <TotalsRow rows={tb.data ?? []} currency={currency} />
              </tbody>
            </TableShell>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

interface CashFlowSectionData {
  adjustments: { code: string; name: string; delta_minor: number }[];
  net_cash_from_operating_minor?: number;
  net_cash_from_investing_minor?: number;
  net_cash_from_financing_minor?: number;
}

function CashFlowSection({
  title,
  section,
  netLabel,
  currency,
}: {
  title: string;
  section: CashFlowSectionData | undefined;
  netLabel: string;
  currency: string;
}) {
  const net =
    section?.net_cash_from_operating_minor ?? section?.net_cash_from_investing_minor ?? section?.net_cash_from_financing_minor ?? 0;
  const adjustments = section?.adjustments ?? [];
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/40">{title}</p>
      {adjustments.length === 0 ? (
        <p className="text-sm text-charcoal-ink/40">No activity in this period.</p>
      ) : (
        <TableShell>
          <tbody>
            {adjustments.map((a) => (
              <tr key={a.code} className="border-b border-charcoal-ink/5">
                <td className="py-1 pr-4 text-charcoal-ink/70">
                  <span className="font-mono text-xs text-charcoal-ink/40">{a.code}</span> {a.name}
                </td>
                <td className="py-1 text-right tabular-nums text-charcoal-ink">{formatMinor(a.delta_minor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <div className="mt-1 flex items-center justify-between text-sm">
        <span className="text-charcoal-ink/60">{netLabel}</span>
        <b className="tabular-nums">{formatMinor(net, currency)}</b>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-charcoal-ink/60">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-charcoal-ink" : "text-charcoal-ink/80"}`}>{value}</dd>
    </div>
  );
}

function StatementByType({
  accounts,
  currency,
  types,
}: {
  accounts: { code: string; name: string; type: string; amount_minor: number }[];
  currency: string;
  types: string[];
}) {
  return (
    <div className="space-y-3">
      {types.map((t) => {
        const rows = accounts.filter((a) => a.type === t);
        if (rows.length === 0) return null;
        return (
          <div key={t}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/40">{TYPE_LABEL[t] ?? t}</p>
            <TableShell>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className="border-b border-charcoal-ink/5">
                    <td className="py-1.5 pr-4 text-charcoal-ink/70">
                      <span className="font-mono text-xs text-charcoal-ink/40">{r.code}</span> {r.name}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-charcoal-ink">{formatMinor(r.amount_minor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        );
      })}
    </div>
  );
}

function TotalsRow({ rows, currency }: { rows: { debit_minor: number; credit_minor: number }[]; currency: string }) {
  const d = rows.reduce((s, r) => s + r.debit_minor, 0);
  const c = rows.reduce((s, r) => s + r.credit_minor, 0);
  return (
    <tr className="border-t-2 border-charcoal-ink/20 font-semibold">
      <td className="py-2 pr-4 text-charcoal-ink">Total</td>
      <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(d, currency)}</td>
      <td className="py-2 text-right tabular-nums">{formatMinor(c, currency)}</td>
    </tr>
  );
}
