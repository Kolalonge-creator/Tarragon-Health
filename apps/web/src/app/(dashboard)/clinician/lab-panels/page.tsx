import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { LabPanelsPanel } from "../_signoff-panels/lab-panels-panel";

/** The Chief Medical Officer's own path to sign the lab ranges (S27d, OQ-176). The database refuses anyone else. */
export default async function ClinicianLabPanelsPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Lab ranges and release policy" description="Reference ranges, critical limits and the disclosure policy behind automatic result release." />
      <LabPanelsPanel />
    </div>
  );
}
