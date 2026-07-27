import { PayablesAndVendors } from "../_components/payables";

export default function FinancePayablesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Payables &amp; vendors</h1>
        <p className="text-charcoal-ink/60">
          Vendor bills for operating spend — draft, approve, pay — with withholding tax and an aging
          view of what&apos;s outstanding.
        </p>
      </div>
      <PayablesAndVendors />
    </div>
  );
}
