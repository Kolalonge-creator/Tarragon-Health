import Link from "next/link";
import { SupportTicketWorklist } from "./support-ticket-worklist";

/**
 * Patient Support & Service Centre — the staff-facing ticket queue (§24.4).
 * Any org staff (including a Care Coordinator, §24.2's non-clinical
 * categories are exactly their kind of work) can triage, assign, and reply
 * to tickets. Escalating a ticket into clinical review (§24.7/24.8) is
 * gated per-ticket on its own detail page (canEscalate there mirrors
 * private.can_handle_support_escalation, the same way the escalations page
 * mirrors canHandleEmergencyEscalation) — the queue itself needs no gate.
 */
export default async function ClinicianSupportTicketsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Support tickets</h1>
          <p className="text-sm text-charcoal-ink/60">
            Everything a patient has sent in — app, appointment, lab, pharmacy, or payment issues.
          </p>
        </div>
        <Link
          href="/clinician/support-tickets/knowledge-base"
          className="text-sm font-medium text-charcoal-ink/70 underline underline-offset-2 hover:text-charcoal-ink"
        >
          Internal knowledge base
        </Link>
      </div>
      <SupportTicketWorklist />
    </div>
  );
}
