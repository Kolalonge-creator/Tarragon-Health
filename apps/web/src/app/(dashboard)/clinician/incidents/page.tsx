import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { IncidentLog } from "./incident-log";

export const metadata = { title: "Incidents & near misses" };

/**
 * The clinical incident / near-miss log (spec §31.7–§31.11) — the reporting
 * end of Tarragon's safety-management system, and the feature behind the
 * Clinical Tier Ladder's standing Tier 3 QA/spot-audit responsibility.
 *
 * Open to every org staff account that reaches the clinician surface,
 * Care Coordinators included: filing a report needs no clinical authority,
 * and a coordinator noticing a near miss is exactly what this log is for.
 * Reviewing and closing does need it, so `canReview` is resolved here from
 * the caller's own clinical_staff record and passed down — the DB trigger
 * remains the enforcement boundary either way.
 */
export default async function ClinicalIncidentsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "clinician" && profile?.role !== "care_coordinator") {
    redirect("/dashboard");
  }
  const staff = await getCurrentClinicalStaff();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldAlert}
        title="Incidents & near misses"
        description="Report anything that harmed a patient, or nearly did. Near misses matter as much as incidents — they are how the system gets fixed before somebody is hurt. Reports are reviewed by a doctor and closed with a stated finding and corrective action."
      />
      <IncidentLog canReview={isClinicalTier(staff ?? null)} />
    </div>
  );
}
