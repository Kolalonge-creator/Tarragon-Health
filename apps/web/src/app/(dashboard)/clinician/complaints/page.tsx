import { ComplaintWorklist } from "./complaint-worklist";

/**
 * §24.14's complaints governance queue. Any org staff can acknowledge,
 * assign, investigate, and respond; only an admin or the org's Clinical
 * Director can complete the terminal governance_review step — gated
 * per-complaint on its own detail page (mirrors
 * private.can_review_complaint_governance).
 */
export default function ClinicianComplaintsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Complaints</h1>
        <p className="text-sm text-charcoal-ink/60">
          Every open complaint should have an accountable owner and move toward governance review.
        </p>
      </div>
      <ComplaintWorklist />
    </div>
  );
}
