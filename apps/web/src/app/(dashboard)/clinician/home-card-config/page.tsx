import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { HomeCardConfigPanel } from "../_signoff-panels/home-card-config-panel";

/** The Chief Medical Officer's own path to sign the Today screen configuration (S47b). The database refuses anyone else. */
export default async function ClinicianHomeCardConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Today screen, weekly summary and readiness" description="Which cards the Today screen can show and the numbers behind the weekly summary and the wearable readiness line. Off for every patient until signed." />
      <HomeCardConfigPanel />
    </div>
  );
}
