import { Budgets } from "../_components/budgets";

export default function FinanceBudgetsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Budgets</h1>
        <p className="text-charcoal-ink/60">
          Monthly budgets per account and cost center, compared against real ledger activity.
        </p>
      </div>
      <Budgets />
    </div>
  );
}
