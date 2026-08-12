"use client";

import {
  useKpiSummary,
  useIncomeStatement,
  useBalanceSheet,
  useCashFlowStatement,
  useTrialBalance,
} from "@/lib/finance/queries";
import { ReportLetterhead } from "./letterhead";
import { PrintToolbar } from "./print-toolbar";
import {
  PrintSection,
  PrintTable,
  PrintTh,
  PrintTd,
  PrintEmpty,
  PrintKeyValue,
  Disclaimer,
  formatMinor,
  formatPercent,
} from "./print-primitives";

const TYPE_LABEL: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
};

function pct(v: number | null) {
  return v == null ? "—" : formatPercent(v);
}

export function InvestorPack({ from, to, currency }: { from: string; to: string; currency: string }) {
  const kpi = useKpiSummary(currency);
  const pnl = useIncomeStatement(from, to, currency);
  const bs = useBalanceSheet(to, currency);
  const cf = useCashFlowStatement(from, to, currency);
  const tb = useTrialBalance(to, currency);

  return (
    <div>
      <PrintToolbar />
      <ReportLetterhead
        title="Fundraising / investor pack"
        subtitle={`${from} to ${to} · ${currency} · balance sheet as of ${to}`}
      />

      <Disclaimer>
        Built from the same live general ledger the rest of Finance uses — not audited or reviewed by
        an external accountant. Say so to anyone you share it with, and have it reviewed before it goes
        into a formal data room.
      </Disclaimer>

      <PrintSection title="Key metrics (as of today)" description="Point-in-time ratios — independent of the date range above.">
        {kpi.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 sm:grid-cols-3">
            <PrintKeyValue label="Revenue, month to date" value={formatMinor(kpi.data?.revenue_mtd_minor ?? 0, currency)} />
            <PrintKeyValue label="Gross margin" value={pct(kpi.data?.gross_margin_pct ?? null)} />
            <PrintKeyValue label="Net margin" value={pct(kpi.data?.net_margin_pct ?? null)} />
            <PrintKeyValue label="Month-on-month revenue growth" value={pct(kpi.data?.mom_revenue_growth_pct ?? null)} />
            <PrintKeyValue label="Year-on-year revenue growth" value={pct(kpi.data?.yoy_revenue_growth_pct ?? null)} />
            <PrintKeyValue label="Days sales outstanding" value={kpi.data?.dso_days != null ? `${kpi.data.dso_days} days` : "—"} />
            <PrintKeyValue label="Cash runway" value={kpi.data?.cash_runway_months != null ? `${kpi.data.cash_runway_months} months` : "—"} />
            <PrintKeyValue label="Cash on hand" value={formatMinor(kpi.data?.cash_minor ?? 0, currency)} />
            <PrintKeyValue label="Receivables" value={formatMinor(kpi.data?.receivable_minor ?? 0, currency)} />
          </div>
        )}
      </PrintSection>

      <PrintSection title="Income statement (P&L)" description={`${from} to ${to} · ${currency}`}>
        {pnl.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <>
            <PrintTable>
              <tbody>
                {(pnl.data?.lines ?? []).map((l) => (
                  <tr key={l.code}>
                    <PrintTd>{l.name}</PrintTd>
                    <PrintTd right>{formatMinor(l.amount_minor, currency)}</PrintTd>
                  </tr>
                ))}
              </tbody>
            </PrintTable>
            <div className="mt-2 max-w-sm">
              <PrintKeyValue label="Net revenue" value={formatMinor(pnl.data?.net_revenue_minor ?? 0, currency)} />
              <PrintKeyValue label="Expenses" value={formatMinor(pnl.data?.expense_minor ?? 0, currency)} />
              <PrintKeyValue label="Net income" value={formatMinor(pnl.data?.net_income_minor ?? 0, currency)} strong />
            </div>
          </>
        )}
      </PrintSection>

      <PrintSection title="Balance sheet" description={`As of ${to} · ${currency}`}>
        {bs.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <>
            {(["asset", "liability", "equity"] as const).map((t) => {
              const accounts = (bs.data?.accounts ?? []).filter((a) => a.type === t);
              if (accounts.length === 0) return null;
              return (
                <div key={t} className="mb-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-charcoal-ink/40">{TYPE_LABEL[t]}</p>
                  <PrintTable>
                    <tbody>
                      {accounts.map((a) => (
                        <tr key={a.code}>
                          <PrintTd>{a.name}</PrintTd>
                          <PrintTd right>{formatMinor(a.amount_minor, currency)}</PrintTd>
                        </tr>
                      ))}
                    </tbody>
                  </PrintTable>
                </div>
              );
            })}
            <div className="mt-2 max-w-sm">
              <PrintKeyValue label="Total assets" value={formatMinor(bs.data?.assets_minor ?? 0, currency)} />
              <PrintKeyValue label="Total liabilities" value={formatMinor(bs.data?.liabilities_minor ?? 0, currency)} />
              <PrintKeyValue label="Total equity" value={formatMinor(bs.data?.total_equity_minor ?? 0, currency)} strong />
            </div>
          </>
        )}
      </PrintSection>

      <PrintSection title="Cash flow statement" description={`${from} to ${to} · ${currency} · indirect method`} breakBefore>
        {cf.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <div className="max-w-sm">
            <PrintKeyValue label="Net cash from operating" value={formatMinor(cf.data?.operating.net_cash_from_operating_minor ?? 0, currency)} />
            <PrintKeyValue label="Net cash from investing" value={formatMinor(cf.data?.investing.net_cash_from_investing_minor ?? 0, currency)} />
            <PrintKeyValue label="Net cash from financing" value={formatMinor(cf.data?.financing.net_cash_from_financing_minor ?? 0, currency)} />
            <PrintKeyValue label="Net change in cash" value={formatMinor(cf.data?.net_change_in_cash_minor ?? 0, currency)} />
            <PrintKeyValue label="Cash, end of period" value={formatMinor(cf.data?.cash_ending_minor ?? 0, currency)} strong />
          </div>
        )}
      </PrintSection>

      <PrintSection title="Capitalisation table" description="Not tracked on the platform.">
        <p className="text-xs text-charcoal-ink/60">
          TarragonHealth does not maintain a cap table in-app. Attach it separately (e.g. from your
          share register or Carta) until equity/shares are tracked here.
        </p>
      </PrintSection>

      <PrintSection title="Non-financial KPIs" description="Not included in this pack.">
        <p className="text-xs text-charcoal-ink/60">
          Active patients, retention, condition-programme enrolment and partner-network metrics live in
          the Analytics console (Analytics → Overview and category pages) rather than duplicated here —
          pull those separately for a complete data room.
        </p>
      </PrintSection>

      <PrintSection title="Appendix: trial balance" description={`As of ${to} · ${currency}`} breakBefore>
        {tb.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (tb.data ?? []).length === 0 ? (
          <PrintEmpty>No ledger activity.</PrintEmpty>
        ) : (
          <PrintTable>
            <thead>
              <tr><PrintTh>Account</PrintTh><PrintTh right>Debit</PrintTh><PrintTh right>Credit</PrintTh></tr>
            </thead>
            <tbody>
              {(tb.data ?? []).map((r) => (
                <tr key={r.code}>
                  <PrintTd>{r.name}</PrintTd>
                  <PrintTd right>{r.debit_minor ? formatMinor(r.debit_minor, currency) : ""}</PrintTd>
                  <PrintTd right>{r.credit_minor ? formatMinor(r.credit_minor, currency) : ""}</PrintTd>
                </tr>
              ))}
            </tbody>
          </PrintTable>
        )}
      </PrintSection>
    </div>
  );
}
