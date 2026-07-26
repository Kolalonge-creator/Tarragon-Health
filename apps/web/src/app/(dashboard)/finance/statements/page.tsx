import { FinanceStatements } from "../_components/statements";

export default function FinanceStatementsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Financial statements</h1>
        <p className="text-charcoal-ink/60">
          Income statement, balance sheet and trial balance, computed live from the ledger per currency.
        </p>
      </div>
      <FinanceStatements />
    </div>
  );
}
