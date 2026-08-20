"use client";

import Link from "next/link";
import { NAV_ICON } from "@/lib/icons";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { useFinanceDashboard, useKpiSummary, useRiskFlags } from "@/lib/finance/queries";
import { SectionCard, CenterNote, formatMinor, formatNumber } from "./primitives";

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`;
}

export function FinanceOverview() {
  const { data, isLoading, isError } = useFinanceDashboard();
  const kpis = useKpiSummary("NGN");
  const flags = useRiskFlags();

  if (isError) {
    return <CenterNote>Could not load finance data. You may not have finance access.</CenterNote>;
  }

  const flagCount =
    (flags.data?.pending_approvals_count ?? 0) +
    (flags.data?.aged_unreconciled_count ?? 0) +
    (flags.data?.reconciliation_flags_count ?? 0) +
    (flags.data?.ap_overdue_count ?? 0) +
    (flags.data?.compliance_overdue_count ?? 0);

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        This is the platform&apos;s live double-entry general ledger. Payments, refunds, voucher
        top-ups and commissions post automatically; subscription revenue is deferred and recognised
        over each billing period. Figures below are NGN; diaspora currencies are shown per statement.
      </p>

      {flagCount > 0 && (
        <SectionCard title="Needs attention" description="Bookkeeping health flags across the finance console.">
          <div className="flex flex-wrap gap-2">
            {(flags.data?.pending_approvals_count ?? 0) > 0 && (
              <Link href="/finance/approvals">
                <Badge variant="amber">{flags.data?.pending_approvals_count} pending approval{flags.data?.pending_approvals_count === 1 ? "" : "s"}</Badge>
              </Link>
            )}
            {(flags.data?.aged_unreconciled_count ?? 0) > 0 && (
              <Link href="/finance/reconciliation">
                <Badge variant="red">{flags.data?.aged_unreconciled_count} unreconciled payment{flags.data?.aged_unreconciled_count === 1 ? "" : "s"} &gt;7 days old</Badge>
              </Link>
            )}
            {(flags.data?.reconciliation_flags_count ?? 0) > 0 && (
              <Link href="/finance/reconciliation">
                <Badge variant="red">{flags.data?.reconciliation_flags_count} reconciliation flag{flags.data?.reconciliation_flags_count === 1 ? "" : "s"}</Badge>
              </Link>
            )}
            {(flags.data?.ap_overdue_count ?? 0) > 0 && (
              <Link href="/finance/payables">
                <Badge variant="red">{flags.data?.ap_overdue_count} overdue bill{flags.data?.ap_overdue_count === 1 ? "" : "s"}</Badge>
              </Link>
            )}
            {(flags.data?.ap_due_soon_count ?? 0) > 0 && (
              <Link href="/finance/payables">
                <Badge variant="amber">{flags.data?.ap_due_soon_count} bill{flags.data?.ap_due_soon_count === 1 ? "" : "s"} due within 7 days</Badge>
              </Link>
            )}
            {(flags.data?.compliance_overdue_count ?? 0) > 0 && (
              <Link href="/finance/compliance">
                <Badge variant="red">{flags.data?.compliance_overdue_count} overdue statutory filing{flags.data?.compliance_overdue_count === 1 ? "" : "s"}</Badge>
              </Link>
            )}
          </div>
        </SectionCard>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={NAV_ICON.cash} label="Cash & clearing (NGN)" value={formatMinor(data?.cash_ngn ?? 0, "NGN")} />
        <StatTile icon={NAV_ICON.growth} label="Revenue YTD (NGN)" value={formatMinor(data?.revenue_ytd_ngn ?? 0, "NGN")} />
        <StatTile icon={NAV_ICON.reconcile} label="Deferred revenue" value={formatMinor(data?.deferred_revenue_ngn ?? 0, "NGN")} />
        <StatTile icon={NAV_ICON.receivables} label="Receivables" value={formatMinor(data?.receivables_ngn ?? 0, "NGN")} />
        <StatTile icon={NAV_ICON.tax} label="VAT payable" value={formatMinor(data?.vat_payable_ngn ?? 0, "NGN")} />
        <StatTile icon={NAV_ICON.finance} label="WHT payable" value={formatMinor(data?.wht_payable_ngn ?? 0, "NGN")} />
        <StatTile icon={NAV_ICON.voucher} label="Customer prepayments" value={formatMinor(data?.care_voucher_liability_ngn ?? 0, "NGN")} />
        <StatTile
          icon={NAV_ICON.flagged}
          label="Unreconciled payments"
          value={formatNumber(data?.unreconciled.count ?? 0)}
        />
      </div>

      <SectionCard title="Key ratios (NGN, month to date)" description="Margin, growth and cash-health at a glance.">
        {kpis.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={NAV_ICON.percentage} label="Gross margin" value={kpis.data?.gross_margin_pct != null ? `${kpis.data.gross_margin_pct}%` : "—"} />
            <StatTile icon={NAV_ICON.caseload} label="Net margin" value={kpis.data?.net_margin_pct != null ? `${kpis.data.net_margin_pct}%` : "—"} />
            <StatTile icon={NAV_ICON.growth} label="MoM revenue growth" value={pct(kpis.data?.mom_revenue_growth_pct)} />
            <StatTile icon={NAV_ICON.growth} label="YoY revenue growth" value={pct(kpis.data?.yoy_revenue_growth_pct)} />
            <StatTile icon={NAV_ICON.duration} label="Days sales outstanding" value={kpis.data?.dso_days != null ? `${kpis.data.dso_days}d` : "—"} />
            <StatTile icon={NAV_ICON.budget} label="Cash runway" value={kpis.data?.cash_runway_months != null ? `${kpis.data.cash_runway_months} mo` : "—"} />
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Revenue by currency" description="Net recognised + point-of-sale revenue booked to date.">
          {isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (data?.revenue_by_currency ?? []).length === 0 ? (
            <CenterNote>No revenue booked yet.</CenterNote>
          ) : (
            <ul className="space-y-2">
              {(data?.revenue_by_currency ?? []).map((r) => (
                <li key={r.currency ?? "?"} className="flex items-center justify-between text-sm">
                  <span className="text-charcoal-ink/70">{r.currency ?? "—"}</span>
                  <span className="font-medium tabular-nums text-charcoal-ink">
                    {formatMinor(r.recognised_minor, r.currency ?? "NGN")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Ledger status" description="Bookkeeping health at a glance.">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-charcoal-ink/60">Current open period</dt>
              <dd className="font-medium text-charcoal-ink">{data?.open_period ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-charcoal-ink/60">Journal entries posted</dt>
              <dd className="font-medium tabular-nums text-charcoal-ink">{formatNumber(data?.entries_count ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-charcoal-ink/60">Revenue this month (NGN)</dt>
              <dd className="font-medium tabular-nums text-charcoal-ink">{formatMinor(data?.revenue_mtd_ngn ?? 0, "NGN")}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-charcoal-ink/60">Operating expense YTD (NGN)</dt>
              <dd className="font-medium tabular-nums text-charcoal-ink">{formatMinor(data?.expenses_ytd_ngn ?? 0, "NGN")}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/finance/ledger" className="text-xs font-medium text-brand-green hover:underline">General ledger →</Link>
            <Link href="/finance/statements" className="text-xs font-medium text-brand-green hover:underline">Statements →</Link>
            <Link href="/finance/reconciliation" className="text-xs font-medium text-brand-green hover:underline">Reconciliation →</Link>
            <Link href="/finance/payables" className="text-xs font-medium text-brand-green hover:underline">Payables →</Link>
            <Link href="/finance/compliance" className="text-xs font-medium text-brand-green hover:underline">Compliance calendar →</Link>
            <Link href="/finance/approvals" className="text-xs font-medium text-brand-green hover:underline">Approvals →</Link>
            <Link href="/finance/audit" className="text-xs font-medium text-brand-green hover:underline">Audit log →</Link>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
