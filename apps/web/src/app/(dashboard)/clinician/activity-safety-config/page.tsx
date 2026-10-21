import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { ActivitySafetyConfigPanel } from "../_signoff-panels/activity-safety-config-panel";

/** The Chief Medical Officer's own path to sign the activity safety rules (S48a). The database refuses anyone else. */
export default async function ClinicianActivitySafetyConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Activity safety rules" description="When a patient is told to rest or kept to gentle activity, and which kinds of activity are offered for pregnancy, arthritis, back pain and unsettled blood pressure." />
      <ActivitySafetyConfigPanel />
    </div>
  );
}
