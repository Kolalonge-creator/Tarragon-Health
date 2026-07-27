import { FinanceAuditLog } from "../_components/audit";

export default function FinanceAuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Audit log</h1>
        <p className="text-charcoal-ink/60">
          Who did what, and when — every human-triggered finance action, read straight from the
          platform&apos;s immutable audit log.
        </p>
      </div>
      <FinanceAuditLog />
    </div>
  );
}
