import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canHandleEmergencyEscalation } from "@/lib/clinical/doctor-tier";
import { EscalationWorklist } from "./escalation-worklist";

/**
 * Escalated cases needing senior review — every doctor (unified access,
 * founder decision 2026-07-31) can view and work this queue, not just a
 * former Tier 4/5 subset. Ranked by severity + SLA breach, not raise order.
 * Claiming/resolving an emergency-level case is the one action still gated
 * to Tier 2+/Clinical Director — see canHandleEmergencyEscalation.
 * Detail view: ./[escalationId].
 */
export default async function ClinicianEscalationsPage() {
  const staff = await getCurrentClinicalStaff();
  const canHandleEmergency = canHandleEmergencyEscalation(staff);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Escalations</h1>
        <p className="text-sm text-charcoal-ink/60">
          Cases escalated for senior review, most urgent first.
        </p>
      </div>
      <EscalationWorklist canHandleEmergency={canHandleEmergency} />
    </div>
  );
}
