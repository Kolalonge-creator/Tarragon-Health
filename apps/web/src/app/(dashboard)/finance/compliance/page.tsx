import { ComplianceCalendar } from "../_components/compliance";

export default function FinanceCompliancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Compliance calendar</h1>
        <p className="text-charcoal-ink/60">
          Nigeria&apos;s recurring statutory filings — VAT, WHT, PAYE, pension and annual CIT — with
          due-date tracking and a filed/remitted record.
        </p>
      </div>
      <ComplianceCalendar />
    </div>
  );
}
