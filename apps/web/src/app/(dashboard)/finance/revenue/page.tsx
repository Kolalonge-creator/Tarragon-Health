import { RevenueRecognition } from "../_components/revenue";

export default function FinanceRevenuePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Revenue recognition</h1>
        <p className="text-charcoal-ink/60">
          Deferred revenue and the straight-line schedules that recognise it over each billing period.
        </p>
      </div>
      <RevenueRecognition />
    </div>
  );
}
