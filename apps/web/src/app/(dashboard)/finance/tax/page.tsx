import { TaxConsole } from "../_components/tax";

export default function FinanceTaxPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Tax</h1>
        <p className="text-charcoal-ink/60">
          VAT and withholding-tax position for the period, plus editable statutory rates.
        </p>
      </div>
      <TaxConsole />
    </div>
  );
}
