import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { MyHealthConfigPanel } from "../_signoff-panels/my-health-config-panel";

/** The Chief Medical Officer's own path to sign the lock-screen pass field list (S09x, C8). The database refuses anyone else. */
export default async function ClinicianMyHealthConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="My Health lock-screen pass" description="The fields a lock-screen or wallet pass may carry. Off for every patient until they turn it on." />
      <MyHealthConfigPanel />
    </div>
  );
}
