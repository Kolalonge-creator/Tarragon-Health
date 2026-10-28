import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { LowCarbProtocolConfigPanel } from "../_signoff-panels/lowcarb-protocol-config-panel";

/** The Chief Medical Officer's own path to sign the low-carbohydrate programme rules (S50b). The database refuses anyone else. */
export default async function ClinicianLowCarbProtocolConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Low-carbohydrate programme rules" description="Who is offered the supervised programme for type 2 diabetes, how often people check in, the lines that pause it, and when a doctor must review medicines." />
      <LowCarbProtocolConfigPanel />
    </div>
  );
}
