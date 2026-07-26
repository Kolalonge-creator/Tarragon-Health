import { FinanceSettings } from "../_components/settings";

export default function FinanceSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Periods &amp; accounts</h1>
        <p className="text-charcoal-ink/60">
          Open and close accounting periods, and manage the chart of accounts and VAT treatment.
        </p>
      </div>
      <FinanceSettings />
    </div>
  );
}
