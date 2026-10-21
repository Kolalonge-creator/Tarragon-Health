import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { HealthReportConfigPanel } from "../_signoff-panels/health-report-config-panel";

/** The Chief Medical Officer's own path to sign the yearly Health Report settings. The database refuses anyone else. */
export default async function ClinicianHealthReportConfigPage() {
  if (!canAssignCases(await getCurrentClinicalStaff())) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Yearly report settings" description="Targets, minimum readings, priority windows, suggested recheck weeks and the fixed statement behind every yearly Health Report." />
      <HealthReportConfigPanel />
    </div>
  );
}
