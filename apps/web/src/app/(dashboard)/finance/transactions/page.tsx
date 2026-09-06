import { UnifiedLedgerLookup } from "../_components/unified-ledger";

export default function FinanceTransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Transactions</h1>
        <p className="text-charcoal-ink/60">
          Payer, recipient, service, and status for a patient&apos;s transactions in one place:
          joins the payment log against the general ledger. For the raw double-entry journal, see{" "}
          General ledger.
        </p>
      </div>
      <UnifiedLedgerLookup />
    </div>
  );
}
