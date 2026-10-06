import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { readLabPanels } from "@/lib/lab-results/read-lab-panels";
import { PageHeader } from "@/components/ui/page-header";
import { LabPanelsView } from "./lab-panels-view";

/** The Chief Medical Officer's own path to sign the lab ranges (S27d, OQ-176). The database refuses anyone else. */
export default async function ClinicianLabPanelsPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const { signoff, panels, loadFailed } = await readLabPanels(await createClient());
  return (
    <div className="space-y-6">
      <PageHeader title="Lab ranges and release policy" description="Reference ranges, critical limits and the disclosure policy behind automatic result release." />
      {loadFailed ? <p role="alert" className="text-sm text-red-700">The lab ranges could not be loaded. Please refresh.</p> : <LabPanelsView signoff={signoff} panels={panels} canSign />}
    </div>
  );
}
