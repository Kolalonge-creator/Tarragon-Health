import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { BpBandReport } from "./bp-band-report";

/** The Chief Medical Officer's read-only view of where the app blood pressure bands and the live alert trigger disagree (OQ-67). */
export default async function ClinicianBpBandReportPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Blood pressure bands: app against alerts" description="Last 30 days. Read only. Nothing here changes a threshold." />
      <BpBandReport />
    </div>
  );
}
