import { FraudSignals } from "../_components/fraud-signals";

export default function FinanceFraudPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Fraud signals</h1>
        <p className="text-charcoal-ink/60">
          Duplicate charges, unusual payment velocity, refund concentration, and disputes, swept
          daily, plus disputes recorded the moment a provider webhook reports one.
        </p>
      </div>
      <FraudSignals />
    </div>
  );
}
