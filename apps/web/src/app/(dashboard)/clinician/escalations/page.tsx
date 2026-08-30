import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canHandleEmergencyEscalation, isClinicalTier, canAssignCases } from "@/lib/clinical/doctor-tier";
import { EscalationWorklist } from "./escalation-worklist";

/**
 * Escalated cases needing senior review — every doctor (unified access,
 * founder decision 2026-07-31) can view and work this queue, not just a
 * former senior-tier subset. Ranked by severity + SLA breach, not raise
 * order. Claiming/resolving an emergency-level case is the one action still
 * gated to Senior Medical Officer+ — see canHandleEmergencyEscalation.
 * Claiming *any* case at all is gated to isClinicalTier: a Care Coordinator
 * can raise an escalation (hand a case to a doctor) but must never claim or
 * resolve one themselves — see the "Care Coordinator write access" rule in
 * CLAUDE.md. That rule is enforced here at the app layer, not in RLS (same
 * pattern as the Clinical Director protocol-signing gate), since Care
 * Coordinators carry an active clinical_staff row too and read the same
 * org-wide escalations_select policy as everyone else. canAssignCases gates
 * the Chief Medical Officer's "Assign to…" reassignment control.
 * Detail view: ./[escalationId].
 */
export default async function ClinicianEscalationsPage() {
  const staff = await getCurrentClinicalStaff();
  const canHandleEmergency = canHandleEmergencyEscalation(staff);
  const canClaim = isClinicalTier(staff);
  const canAssign = canAssignCases(staff);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Escalations</h1>
        <p className="text-sm text-charcoal-ink/60">
          Cases escalated for senior review, most urgent first.
        </p>
      </div>
      <EscalationWorklist canHandleEmergency={canHandleEmergency} canClaim={canClaim} canAssign={canAssign} />
    </div>
  );
}
