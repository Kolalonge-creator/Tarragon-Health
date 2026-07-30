import { ApprovalsQueue } from "../_components/approvals";

export default function FinanceApprovalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Approvals</h1>
        <p className="text-charcoal-ink/60">
          A four-eyes control for large manual journal entries and period locks: a different finance
          officer must review before anything posts.
        </p>
      </div>
      <ApprovalsQueue />
    </div>
  );
}
