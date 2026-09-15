import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canHandleEmergencyEscalation, isClinicalTier, canAssignCases } from "@/lib/clinical/doctor-tier";
import { EscalationWorklist } from "./escalation-worklist";

/**
 * Escalated cases needing senior review — every case is routed automatically
 * to a specific doctor's queue at creation (private.auto_assign_escalation,
 * 20260831001458), least-loaded-first; the CMO is not a manual dispatcher
 * for every patient, they oversee (see /clinician/team-caseload) and can
 * rebalance or step into any case, but most cases never need that. Every
 * doctor tier can view and work this queue (unified access, founder decision
 * 2026-07-31) — but starting review on a case is restricted to the doctor
 * it's actually assigned to (or the CMO), and claiming/resolving an
 * emergency-level case specifically needs Senior Medical Officer+ — see
 * canHandleEmergencyEscalation. Claiming an unassigned case at all (the rare
 * fallback for when auto-assignment found nobody) is gated to
 * isClinicalTier: a Care Coordinator can raise an escalation (hand a case to
 * a doctor) but must never claim or resolve one themselves — see the "Care
 * Coordinator write access" rule in CLAUDE.md. That rule is enforced here at
 * the app layer, not in RLS (same pattern as the Clinical Director
 * protocol-signing gate), since Care Coordinators carry an active
 * clinical_staff row too and read the same org-wide escalations_select
 * policy as everyone else. canAssignCases gates the Chief Medical Officer's
 * "Assign to…" override control.
 * Detail view: ./[escalationId].
 */
export default async function ClinicianEscalationsPage() {
  const [staff, profile] = await Promise.all([getCurrentClinicalStaff(), getCurrentProfile()]);
  const canHandleEmergency = canHandleEmergencyEscalation(staff);
  const canClaim = isClinicalTier(staff);
  const canAssign = canAssignCases(staff);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Escalations</h1>
        <p className="text-sm text-charcoal-ink/60">
          Cases escalated for senior review, most urgent first — each is already routed to a
          doctor when it&apos;s raised.
        </p>
      </div>
      <EscalationWorklist
        canHandleEmergency={canHandleEmergency}
        canClaim={canClaim}
        canAssign={canAssign}
        currentProfileId={profile?.id ?? null}
      />
    </div>
  );
}
