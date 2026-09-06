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
import { refreshQueryState } from "@/lib/queries/list-query-state";
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

/**
 * The money counterpart to pct(). Every figure in this pack used to be
 * written `money(x, currency)`, which turns "we have no number for
 * this" into a printed zero on company letterhead. A missing figure prints as
 * a dash, the same way a missing ratio already did.
 */
function money(v: number | null | undefined, currency: string) {
  return v == null ? "—" : formatMinor(v, currency);
}

export function InvestorPack({ from, to, currency }: { from: string; to: string; currency: string }) {
  const kpi = useKpiSummary(currency);
  const pnl = useIncomeStatement(from, to, currency);
  const bs = useBalanceSheet(to, currency);
  const cf = useCashFlowStatement(from, to, currency);
  const tb = useTrialBalance(to, currency);

  // This document is printed, signed off on, and handed to people outside the
  // company. A failed RPC used to fall through every `?? 0` below and print
  // "Cash on hand ₦0.00" and "Revenue, month to date ₦0.00" under the RC and
  // TIN on the letterhead: not a gap in the pack, a false financial statement
  // in it. So a source that never arrived still stops the pack rendering at
  // all, and says on the page why it must not leave the building.
  //
  // A source that DID arrive and then failed to refresh is a different fact.
  // React Query keeps the last good response and only flips status, so
  // treating that as a missing source threw away a complete, correct pack
  // because a window-focus refetch timed out. Those figures are real; they
  // are simply as of the last successful read, which the printed banner below
  // says on the page and therefore on the paper.
  const sources: { label: string; isError: boolean; hasData: boolean }[] = [
    { label: "key metrics", isError: kpi.isError, hasData: kpi.data !== undefined },
    { label: "income statement", isError: pnl.isError, hasData: pnl.data !== undefined },
    { label: "balance sheet", isError: bs.isError, hasData: bs.data !== undefined },
    { label: "cash flow statement", isError: cf.isError, hasData: cf.data !== undefined },
    { label: "trial balance", isError: tb.isError, hasData: tb.data !== undefined },
  ];
  const failedSources = sources
    .filter((s) => refreshQueryState({ isLoading: false, isError: s.isError, hasData: s.hasData }) === "failed")
    .map((s) => s.label);
  const staleSources = sources
    .filter((s) => refreshQueryState({ isLoading: false, isError: s.isError, hasData: s.hasData }) === "stale")
    .map((s) => s.label);

  if (failedSources.length > 0) {
    return (
      <div>
        <PrintToolbar />
        <ReportLetterhead
          title="Fundraising / investor pack"
          subtitle={`${from} to ${to} · ${currency}`}
        />
        <p className="mb-4 rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-red-700">
          Data unavailable: do not distribute
        </p>
        <p className="text-xs leading-relaxed text-charcoal-ink/70">
          The pack could not be built: {failedSources.join(", ")} did not load from the general
          ledger. No figures are shown, deliberately, because a missing source would print as zero
          revenue and zero cash under the company letterhead, which reads as a statement of fact
          rather than a gap. Reload this page, and if it keeps failing, take it up with whoever
          maintains the finance reporting RPCs before sharing anything from this report.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PrintToolbar />
      <ReportLetterhead
        title="Fundraising / investor pack"
        subtitle={`${from} to ${to} · ${currency} · balance sheet as of ${to}`}
      />

      {/* Printed, not just shown: whoever holds the paper needs to know the
          figures on it were not confirmed on the last attempt. */}
      {staleSources.length > 0 && (
        <p className="mb-4 rounded-md border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-amber-800">
          May be out of date: {staleSources.join(", ")} could not be refreshed. Figures shown are the
          last read from the general ledger. Reload before distributing.
        </p>
      )}

      <Disclaimer>
        Built from the same live general ledger the rest of Finance uses, not audited or reviewed by
        an external accountant. Say so to anyone you share it with, and have it reviewed before it goes
        into a formal data room.
      </Disclaimer>

      <PrintSection title="Key metrics (as of today)" description="Point-in-time ratios, independent of the date range above.">
        {kpi.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 sm:grid-cols-3">
            <PrintKeyValue label="Revenue, month to date" value={money(kpi.data?.revenue_mtd_minor, currency)} />
            <PrintKeyValue label="Gross margin" value={pct(kpi.data?.gross_margin_pct ?? null)} />
            <PrintKeyValue label="Net margin" value={pct(kpi.data?.net_margin_pct ?? null)} />
            <PrintKeyValue label="Month-on-month revenue growth" value={pct(kpi.data?.mom_revenue_growth_pct ?? null)} />
            <PrintKeyValue label="Year-on-year revenue growth" value={pct(kpi.data?.yoy_revenue_growth_pct ?? null)} />
            <PrintKeyValue label="Days sales outstanding" value={kpi.data?.dso_days != null ? `${kpi.data.dso_days} days` : "—"} />
            <PrintKeyValue label="Cash runway" value={kpi.data?.cash_runway_months != null ? `${kpi.data.cash_runway_months} months` : "—"} />
            <PrintKeyValue label="Cash on hand" value={money(kpi.data?.cash_minor, currency)} />
            <PrintKeyValue label="Receivables" value={money(kpi.data?.receivable_minor, currency)} />
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
              <PrintKeyValue label="Net revenue" value={money(pnl.data?.net_revenue_minor, currency)} />
              <PrintKeyValue label="Expenses" value={money(pnl.data?.expense_minor, currency)} />
              <PrintKeyValue label="Net income" value={money(pnl.data?.net_income_minor, currency)} strong />
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
              <PrintKeyValue label="Total assets" value={money(bs.data?.assets_minor, currency)} />
              <PrintKeyValue label="Total liabilities" value={money(bs.data?.liabilities_minor, currency)} />
              <PrintKeyValue label="Total equity" value={money(bs.data?.total_equity_minor, currency)} strong />
            </div>
          </>
        )}
      </PrintSection>

      <PrintSection title="Cash flow statement" description={`${from} to ${to} · ${currency} · indirect method`} breakBefore>
        {cf.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <div className="max-w-sm">
            <PrintKeyValue label="Net cash from operating" value={money(cf.data?.operating.net_cash_from_operating_minor, currency)} />
            <PrintKeyValue label="Net cash from investing" value={money(cf.data?.investing.net_cash_from_investing_minor, currency)} />
            <PrintKeyValue label="Net cash from financing" value={money(cf.data?.financing.net_cash_from_financing_minor, currency)} />
            <PrintKeyValue label="Net change in cash" value={money(cf.data?.net_change_in_cash_minor, currency)} />
            <PrintKeyValue label="Cash, end of period" value={money(cf.data?.cash_ending_minor, currency)} strong />
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
          the Analytics console (Analytics → Overview and category pages) rather than duplicated here.
          Pull those separately for a complete data room.
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
