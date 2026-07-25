"use client";

import Link from "next/link";
import { Banknote, Scale, Receipt, TrendingUp, Wallet, FileText, Landmark, AlertCircle } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useFinanceDashboard } from "@/lib/finance/queries";
import { SectionCard, CenterNote, formatMinor, formatNumber } from "./primitives";

export function FinanceOverview() {
  const { data, isLoading, isError } = useFinanceDashboard();

  if (isError) {
    return <CenterNote>Could not load finance data. You may not have finance access.</CenterNote>;
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        This is the platform&apos;s live double-entry general ledger. Payments, refunds, wallet
        top-ups and commissions post automatically; subscription revenue is deferred and recognised
        over each billing period. Figures below are NGN; diaspora currencies are shown per statement.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Banknote} label="Cash & clearing (NGN)" value={formatMinor(data?.cash_ngn ?? 0, "NGN")} />
        <StatTile icon={TrendingUp} label="Revenue YTD (NGN)" value={formatMinor(data?.revenue_ytd_ngn ?? 0, "NGN")} />
        <StatTile icon={Scale} label="Deferred revenue" value={formatMinor(data?.deferred_revenue_ngn ?? 0, "NGN")} />
        <StatTile icon={FileText} label="Receivables" value={formatMinor(data?.receivables_ngn ?? 0, "NGN")} />
        <StatTile icon={Receipt} label="VAT payable" value={formatMinor(data?.vat_payable_ngn ?? 0, "NGN")} />
        <StatTile icon={Landmark} label="WHT payable" value={formatMinor(data?.wht_payable_ngn ?? 0, "NGN")} />
        <StatTile icon={Wallet} label="Wallet liability" value={formatMinor(data?.wallet_liability_ngn ?? 0, "NGN")} />
        <StatTile
          icon={AlertCircle}
          label="Unreconciled payments"
          value={formatNumber(data?.unreconciled.count ?? 0)}
        />
      </div>

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
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
