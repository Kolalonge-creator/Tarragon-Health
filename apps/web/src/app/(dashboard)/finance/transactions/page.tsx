import { Suspense } from "react";
import { UnifiedLedgerLookup } from "../_components/unified-ledger";
import { TransactionDirectory } from "../_components/transaction-directory";

export const metadata = { title: "Transactions" };

export default function FinanceTransactionsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Transactions</h1>
        <p className="max-w-3xl text-charcoal-ink/60 dark:text-night-ink/60">
          Every payment, failed payment and confirmed refund: checkout orders, Paystack charges and employer invoices, with
          who paid, who it was for and whether Paystack has settled it. Opening a record is logged.
        </p>
      </div>

      {/* Filters live in the URL, which needs a Suspense boundary in Next 16. */}
      <Suspense fallback={null}>
        <TransactionDirectory />
      </Suspense>

      <details className="group rounded-xl border border-charcoal-ink/10 bg-white dark:border-night-ink/15 dark:bg-night-card">
        <summary className="cursor-pointer list-none px-5 py-3 text-sm font-medium text-charcoal-ink dark:text-night-ink">
          Look up one person&apos;s or organisation&apos;s ledger
          <span className="ml-2 text-charcoal-ink/60 dark:text-night-ink/60">(payment log joined to the general ledger)</span>
          <span aria-hidden className="ml-2 inline-block transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="px-5 pb-5">
          <UnifiedLedgerLookup />
        </div>
      </details>
    </div>
  );
}
