import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { BpDevicesList } from "./devices-list";

/** The Chief Medical Officer's review of the recommended blood pressure monitors (S07y). The database refuses anyone else. */
export default async function ClinicianRecommendedDevicesPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Recommended blood pressure monitors"
        description="Check each monitor an admin entered against the public validation registry. A patient is told her model is on the checked list only after you review it. Nothing is shown as checked until then."
      />
      <BpDevicesList mode="cmo" />
    </div>
  );
}
