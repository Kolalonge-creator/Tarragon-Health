import { EmployerBilling } from "../_components/employer-billing";

export default function FinanceEmployerBillingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Employer billing</h1>
        <p className="text-charcoal-ink/60">
          Per-member pricing for employer and HMO organisations, against each org&apos;s real roster
          headcount.
        </p>
      </div>
      <EmployerBilling />
    </div>
  );
}
