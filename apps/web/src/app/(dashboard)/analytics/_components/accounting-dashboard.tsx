"use client";

import { Banknote, FileText, Receipt, Scale } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useAccountingSummary } from "@/lib/analytics/queries";
import { formatMinor } from "@/lib/analytics/format";
import { MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

export function AccountingDashboard() {
  const { data } = useAccountingSummary();
  const rr = data?.revenue_recognition;
  const ar = data?.ar_aging;
  const rec = data?.reconciliation;

  const ngnCollected =
    rec?.payments_collected?.find((p) => p.currency === "NGN")?.total_minor ?? 0;

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Revenue recognition is modeled from subscription billing periods (ASC 606 / IFRS 15 style).
        The general ledger and formal close stay in your accounting system — this is the
        investor/audit-facing evidence layer.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={FileText} label="Billed (current periods)" value={formatMinor(rr?.billed_minor ?? 0, "NGN")} />
        <StatTile icon={Banknote} label="Recognized to date" value={formatMinor(rr?.recognized_minor ?? 0, "NGN")} />
        <StatTile icon={Scale} label="Deferred revenue" value={formatMinor(rr?.deferred_minor ?? 0, "NGN")} />
        <StatTile icon={Receipt} label="Commission receivable" value={formatMinor(ar?.commission_receivable_kobo ?? 0, "NGN")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Revenue recognition by currency"
          description="Billed vs recognized vs deferred for in-progress subscription periods."
          actions={<ExportButton filename="revenue-recognition" rows={rr?.by_currency ?? []} />}
        >
          {(rr?.by_currency ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-charcoal-ink/50">No active subscription periods.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                    <th className="py-2 pr-4 font-medium">Currency</th>
                    <th className="py-2 pr-4 text-right font-medium">Billed</th>
                    <th className="py-2 pr-4 text-right font-medium">Recognized</th>
                    <th className="py-2 text-right font-medium">Deferred</th>
                  </tr>
                </thead>
                <tbody>
                  {(rr?.by_currency ?? []).map((r) => (
                    <tr key={r.currency ?? "unknown"} className="border-b border-charcoal-ink/5">
                      <td className="py-2 pr-4 text-charcoal-ink/70">{r.currency ?? "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMinor(r.billed, r.currency ?? "NGN")}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-brand-green">{formatMinor(r.recognized, r.currency ?? "NGN")}</td>
                      <td className="py-2 text-right tabular-nums">{formatMinor(r.deferred, r.currency ?? "NGN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Accounts receivable aging"
          description="Unpaid commissions by age; plus past-due subscriptions."
          actions={<ExportButton filename="ar-aging" rows={ar?.aging ?? []} />}
        >
          <MiniBarList
            items={(ar?.aging ?? []).map((a) => ({
              label: a.bucket,
              value: a.kobo,
              display: formatMinor(a.kobo, "NGN"),
            }))}
            emptyLabel="No receivables."
          />
          <p className="mt-4 text-sm text-charcoal-ink/70">
            Past-due subscriptions: <b className="text-charcoal-ink">{ar?.subscriptions_past_due ?? 0}</b>
          </p>
        </SectionCard>
      </div>

      <SectionCard
        title="Payment reconciliation"
        description="Collected across providers (Paystack / Stripe) vs recognized revenue."
        actions={<ExportButton filename="payments-collected" rows={rec?.payments_collected ?? []} />}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-charcoal-ink/10 bg-white p-3">
            <p className="text-xs text-charcoal-ink/60">Collected (NGN)</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">{formatMinor(ngnCollected, "NGN")}</p>
          </div>
          <div className="rounded-lg border border-charcoal-ink/10 bg-white p-3">
            <p className="text-xs text-charcoal-ink/60">Recognized (NGN)</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">{formatMinor(rr?.recognized_minor ?? 0, "NGN")}</p>
          </div>
          <div className="rounded-lg border border-charcoal-ink/10 bg-white p-3">
            <p className="text-xs text-charcoal-ink/60">Refunds</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">{formatMinor(rec?.refunds_minor ?? 0, "NGN")}</p>
          </div>
        </div>
        <div className="mt-4">
          <MiniBarList
            items={(rec?.payments_collected ?? []).map((p) => ({
              label: p.currency ?? "Unknown",
              value: p.total_minor,
              display: formatMinor(p.total_minor, p.currency ?? "NGN"),
            }))}
            emptyLabel="No payments recorded."
          />
        </div>
      </SectionCard>
    </div>
  );
}
