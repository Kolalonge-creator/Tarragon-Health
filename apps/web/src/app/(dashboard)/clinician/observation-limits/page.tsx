import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { ObservationLimitsPanel } from "../_signoff-panels/observation-limits-panel";

/** The Chief Medical Officer's own path to sign the plausibility limits for hand-typed numbers (S47a). The database refuses anyone else. */
export default async function ClinicianObservationLimitsPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Limits for typed numbers" description="The numbers a person may type for water, sleep, mood and inhaler use, and the typo limits for the rest. Off for every patient until the module is switched on." />
      <ObservationLimitsPanel />
    </div>
  );
}
