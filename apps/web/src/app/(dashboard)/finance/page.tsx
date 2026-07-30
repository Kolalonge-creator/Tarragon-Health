import { FinanceOverview } from "./_components/overview";

export default function FinanceOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Finance</h1>
        <p className="text-charcoal-ink/60">
          The platform&apos;s books: general ledger, revenue recognition, settlement reconciliation
          and tax, driven straight from live payment and commission events.
        </p>
      </div>
      <FinanceOverview />
    </div>
  );
}
