import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { HomeBpProgrammePanel } from "../_signoff-panels/home-bp-programme-panel";

/** The Chief Medical Officer's own path to sign the home blood pressure programme (S07x). The database refuses anyone else. */
export default async function ClinicianHomeBpProgrammePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Home blood pressure programme" description="The seven-day home check, its bands and the clinician-only white-coat and masked pattern rule." />
      <HomeBpProgrammePanel />
    </div>
  );
}
