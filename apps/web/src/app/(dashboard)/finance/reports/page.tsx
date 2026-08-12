import { ReportsHub } from "./_components/reports-hub";

export default function FinanceReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Reports &amp; filings</h1>
        <p className="text-charcoal-ink/60">
          Three print-ready packs, built from the same live ledger as the rest of Finance: everything
          the company owes a government agency yearly, the pack an investor&apos;s due diligence asks
          for, and the pack an internal or external auditor works from. Each opens as a clean document
          — use your browser&apos;s Print → Save as PDF.
        </p>
      </div>
      <ReportsHub />
    </div>
  );
}
