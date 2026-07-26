import { CapitationRegister } from "../_components/capitation";

export default function FinanceCapitationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">HMO capitation</h1>
        <p className="text-charcoal-ink/60">
          Per-member-per-month contracts with HMO partners, booked distinctly from fee-for-service
          revenue, with a PMPM and loss-ratio register.
        </p>
      </div>
      <CapitationRegister />
    </div>
  );
}
