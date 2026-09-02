import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { MedicationIssuesWorklist } from "./medication-issues-worklist";

/**
 * Pharmacy Engine spec §12.13 (pharmacist/patient-raised medication
 * concerns, routed to a clinician) and §12.16 (medication affordability as
 * a care-management signal) — docs/PHARMACY_ENGINE_SPEC.md Phase 1. Any org
 * staff (clinician, care coordinator, admin) can see and raise both; only a
 * clinical-tier doctor may resolve a concern flag, since that's a clinical
 * judgment (prescription/interaction/duplication) — same isClinicalTier
 * gate the Escalations page uses for claiming a case, and the same "app
 * layer, not RLS" posture (a Care Coordinator carries an active
 * clinical_staff row too, per CLAUDE.md's Care Coordinator write-access
 * rule). Resolving an affordability report has no such gate — §12.16 lists
 * "care coordinator intervention" as one of its own valid actions.
 */
export default async function MedicationIssuesPage() {
  const staff = await getCurrentClinicalStaff();
  const canResolveConcerns = isClinicalTier(staff);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Medication issues
        </h1>
        <p className="text-sm text-charcoal-ink/60">
          Concerns raised about a medication, and patients who could not obtain theirs because of
          cost.
        </p>
      </div>
      <MedicationIssuesWorklist canResolveConcerns={canResolveConcerns} />
    </div>
  );
}
