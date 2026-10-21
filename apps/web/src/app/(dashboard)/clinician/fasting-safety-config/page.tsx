import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { FastingSafetyConfigPanel } from "../_signoff-panels/fasting-safety-config-panel";

/** The Chief Medical Officer's own path to sign the religious-fasting safety rules (S50b). The database refuses anyone else. */
export default async function ClinicianFastingSafetyConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Fasting safety rules" description="Who may start a Ramadan or Lent fasting plan, who is stopped, and which medicines need a signed timing plan first. Nothing shows to patients until signed and switched on." />
      <FastingSafetyConfigPanel />
    </div>
  );
}
