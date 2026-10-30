"use client";

import Link from "next/link";
import {
  Banknote, Scale, Receipt, TrendingUp, Ticket, FileText, Landmark, AlertCircle,
  Percent, Gauge, Clock, PiggyBank, Gift,
} from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import {
  useFinanceDashboard, useKpiSummary, useRevenueByFundingSource, useRiskFlags,
} from "@/lib/finance/queries";
import { buildFinanceOverview } from "@/lib/finance/overview-summary";
import { SectionCard } from "./primitives";

/**
 * A refresh failed but the last good figures are on screen. Names the section
 * so two stale notices on one page are not identical, and says what a reload
 * would show if the cause is a change in finance access (a refused read fails
 * the same way a dropped connection does).
 */
function staleText(which: string): string {
  return `${which} may be out of date: the last refresh failed. They are the last ones we read successfully, not a live count. Reload the page to try again; if your finance access has changed, the reload will say so.`;
}

export function FinanceOverview() {
  const dashboard = useFinanceDashboard();
  const kpis = useKpiSummary("NGN");
  const funding = useRevenueByFundingSource("NGN");
  const flags = useRiskFlags();

  // A figure that has not loaded, or failed to, is never shown as zero (see
  // lib/finance/overview-summary.ts).
  const view = buildFinanceOverview({ dashboard, kpis, funding, flags });
  const { tiles } = view.dashboard;

  return (
    <div className="space-y-6">
      {view.flags.state === "failed" && (
        <LoadFailure>
          The bookkeeping health flags could not be loaded. No flags showing here does not mean
          there are none: fraud signals, overdue filings and unreconciled payments would appear
          here. Reload the page to try again.
        </LoadFailure>
      )}
      {view.flags.state === "stale" && (
        <StaleDataNotice>{staleText("The bookkeeping flags below")}</StaleDataNotice>
      )}
      {view.flags.items.length > 0 && (
        <section
          aria-labelledby="finance-first"
          className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm"
        >
          <h2 id="finance-first" className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
            Needs you first
          </h2>
          <Link
            href={view.flags.items[0].href}
            className="mt-2 inline-flex items-center gap-2 font-heading text-xl font-semibold text-charcoal-ink hover:underline"
          >
            {view.flags.items[0].label}
          </Link>
          <p className="mt-1 text-sm text-charcoal-ink/60">Open it to see the items and deal with them.</p>
          {view.flags.items.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {view.flags.items.slice(1).map((item) => (
                <Link key={item.key} href={item.href}>
                  <Badge variant={item.variant}>{item.label}</Badge>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
      {view.flags.allClear && (
        <p className="rounded-xl border border-charcoal-ink/10 bg-white px-5 py-4 text-sm text-charcoal-ink/70">
          No bookkeeping flags right now.
        </p>
      )}

      {view.dashboard.state === "failed" && (
        <LoadFailure>
          The ledger figures could not be loaded, so the tiles below are blank and not zero. This
          can also happen if you do not have finance access. Reload the page to try again.
        </LoadFailure>
      )}
      {view.dashboard.state === "stale" && (
        <StaleDataNotice>{staleText("The ledger figures below")}</StaleDataNotice>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Banknote} label="Cash & clearing (NGN)" {...tiles.cash} />
        <StatTile icon={TrendingUp} label="Revenue YTD (NGN)" {...tiles.revenueYtd} />
        <StatTile icon={AlertCircle} label="Unreconciled payments" {...tiles.unreconciled} />
        <StatTile icon={Scale} label="Deferred revenue" {...tiles.deferred} />
      </div>
      <details className="group rounded-xl border border-charcoal-ink/10 bg-white">
        <summary className="cursor-pointer list-none px-5 py-3 text-sm font-medium text-charcoal-ink">
          Owed and held <span className="text-charcoal-ink/60">(receivables, VAT, withholding tax, prepayments)</span>
          <span aria-hidden className="ml-2 inline-block transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={FileText} label="Receivables" {...tiles.receivables} />
          <StatTile icon={Receipt} label="VAT payable" {...tiles.vat} />
          <StatTile icon={Landmark} label="WHT payable" {...tiles.wht} />
          <StatTile icon={Ticket} label="Customer prepayments" {...tiles.prepayments} />
        </div>
      </details>

      <SectionCard title="Key ratios (NGN, month to date)" description="Margin, growth and cash-health at a glance.">
        {view.kpis.state === "failed" && (
          <LoadFailure className="mb-4">
            Key ratios could not be loaded. Reload the page to try again.
          </LoadFailure>
        )}
        {view.kpis.state === "stale" && (
          <StaleDataNotice className="mb-4">{staleText("The key ratios below")}</StaleDataNotice>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={Percent} label="Gross margin" {...view.kpis.tiles.grossMargin} />
          <StatTile icon={Gauge} label="Net margin" {...view.kpis.tiles.netMargin} />
          <StatTile icon={TrendingUp} label="MoM revenue growth" {...view.kpis.tiles.momGrowth} />
          <StatTile icon={TrendingUp} label="YoY revenue growth" {...view.kpis.tiles.yoyGrowth} />
          <StatTile icon={Clock} label="Days sales outstanding" {...view.kpis.tiles.dso} />
          <StatTile icon={PiggyBank} label="Cash runway" {...view.kpis.tiles.runway} />
        </div>
      </SectionCard>

      <SectionCard
        title="Revenue by funding source (NGN, month to date)"
        description="How much of this month's revenue was actually collected vs. given away. Promo codes and reward vouchers never represent real cash in the door."
      >
        {view.funding.state === "failed" && (
          <LoadFailure className="mb-4">
            The funding split could not be loaded. Reload the page to try again.
          </LoadFailure>
        )}
        {view.funding.state === "stale" && (
          <StaleDataNotice className="mb-4">{staleText("The funding split below")}</StaleDataNotice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile icon={Banknote} label="Cash collected" {...view.funding.tiles.cash} />
          <StatTile icon={Gift} label="Promo / voucher-funded" {...view.funding.tiles.promotional} />
        </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Revenue by currency" description="Net recognised + point-of-sale revenue booked to date.">
          {view.dashboard.revenueByCurrency.status === "unknown" ? (
            <p className="py-6 text-center text-sm text-charcoal-ink/60">
              {view.dashboard.revenueByCurrency.message}
            </p>
          ) : view.dashboard.revenueByCurrency.status === "empty" ? (
            <p className="py-6 text-center text-sm text-charcoal-ink/60">No revenue booked yet.</p>
          ) : (
            <ul className="space-y-2">
              {view.dashboard.revenueByCurrency.rows.map((r) => (
                <li key={r.currency} className="flex items-center justify-between text-sm">
                  <span className="text-charcoal-ink/70">{r.currency}</span>
                  <span className="font-medium tabular-nums text-charcoal-ink">{r.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Ledger status" description="Bookkeeping health at a glance.">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-charcoal-ink/60">Current open period</dt>
              <dd className="font-medium text-charcoal-ink">{view.dashboard.ledger.openPeriod}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-charcoal-ink/60">Journal entries posted</dt>
              <dd className="font-medium tabular-nums text-charcoal-ink">{view.dashboard.ledger.entries}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-charcoal-ink/60">Revenue this month (NGN)</dt>
              <dd className="font-medium tabular-nums text-charcoal-ink">{view.dashboard.ledger.revenueMtd}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-charcoal-ink/60">Operating expense YTD (NGN)</dt>
              <dd className="font-medium tabular-nums text-charcoal-ink">{view.dashboard.ledger.expensesYtd}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/finance/ledger" className="text-xs font-medium text-brand-green hover:underline">General ledger →</Link>
            <Link href="/finance/statements" className="text-xs font-medium text-brand-green hover:underline">Statements →</Link>
            <Link href="/finance/reconciliation" className="text-xs font-medium text-brand-green hover:underline">Reconciliation →</Link>
            <Link href="/finance/money-reconciliation" className="text-xs font-medium text-brand-green hover:underline">Money reconciliation →</Link>
            <Link href="/finance/settlement-tieout" className="text-xs font-medium text-brand-green hover:underline">Settlement tie-out →</Link>
            <Link href="/finance/payables" className="text-xs font-medium text-brand-green hover:underline">Payables →</Link>
            <Link href="/finance/compliance" className="text-xs font-medium text-brand-green hover:underline">Compliance calendar →</Link>
            <Link href="/finance/approvals" className="text-xs font-medium text-brand-green hover:underline">Approvals →</Link>
            <Link href="/finance/audit" className="text-xs font-medium text-brand-green hover:underline">Audit log →</Link>
          </div>
        </SectionCard>
      </div>
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        This is the platform&apos;s live double-entry general ledger. Payments, refunds, voucher
        payments and commissions post automatically; a service bought up front is deferred until it
        is delivered. All figures are NGN through Paystack, the only live payment provider.
      </p>
    </div>
  );
}
