import { FraudSignals } from "../_components/fraud";

export default function FinanceFraudPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Fraud signals</h1>
        <p className="text-charcoal-ink/60">
          Duplicate charges, unusually fast or frequent payments, refund concentration, and
          out-of-range amounts — flagged for review, never auto-remediated.
        </p>
      </div>
      <FraudSignals />
    </div>
  );
}
