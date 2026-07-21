import { EscalationWorklist } from "../escalation-worklist";

/**
 * Index behind the doctor sidebar "Escalations" link — the same worklist the
 * doctor dashboard renders, on its own page so the nav link resolves.
 * Detail view: ./[escalationId].
 */
export default function DoctorEscalationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Escalations</h1>
        <p className="text-sm text-charcoal-ink/60">
          Cases escalated for senior doctor review, most urgent first.
        </p>
      </div>
      <EscalationWorklist />
    </div>
  );
}
