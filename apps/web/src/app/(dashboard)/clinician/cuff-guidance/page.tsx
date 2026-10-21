import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { CuffGuidancePanel } from "../_signoff-panels/cuff-guidance-panel";

/** The Chief Medical Officer's own path to sign the cuff size guidance (S07y). The database refuses anyone else. */
export default async function ClinicianCuffGuidancePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Home blood pressure cuff sizes" description="The arm measurement to cuff size table shown inside the home check, and the wording that goes with it." />
      <CuffGuidancePanel />
    </div>
  );
}
