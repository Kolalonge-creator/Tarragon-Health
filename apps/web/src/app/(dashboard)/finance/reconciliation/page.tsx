import { Reconciliation } from "../_components/reconciliation";

export default function FinanceReconciliationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Reconciliation</h1>
        <p className="text-charcoal-ink/60">
          Match captured card charges to provider settlement payouts and book the processing fees.
        </p>
      </div>
      <Reconciliation />
    </div>
  );
}
