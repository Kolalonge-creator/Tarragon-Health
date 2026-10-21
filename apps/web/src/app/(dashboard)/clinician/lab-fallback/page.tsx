import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { LabFallbackPanel } from "../_signoff-panels/lab-fallback-panel";

/** The Chief Medical Officer's own path to sign the disclosure fallback wording (S27h). The database refuses anyone else. */
export default async function ClinicianLabFallbackPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Lab result fallback message" description="The one neutral message a patient receives when a held sensitive result still needs to be disclosed and they could not be reached." />
      <LabFallbackPanel />
    </div>
  );
}
