import { LedgerBrowser } from "../_components/ledger";

export default function FinanceLedgerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">General ledger</h1>
        <p className="text-charcoal-ink/60">
          The double-entry journal. Browse posted entries, post adjusting entries, and reverse.
        </p>
      </div>
      <LedgerBrowser />
    </div>
  );
}
