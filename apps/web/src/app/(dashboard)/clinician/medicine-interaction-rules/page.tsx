import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { MedicineInteractionRulesPanel } from "../_signoff-panels/medicine-interaction-rules-panel";

export const metadata = { title: "Medicine interaction rules" };

/**
 * The Chief Medical Officer's own path to the medicine interaction rules (S08y). Born empty and unsigned. The same panel opens
 * inline in the sign-off hub.
 */
export default async function ClinicianMedicineInteractionRulesPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medicine interaction rules"
        description="Ingredient pairs that show a short care-team message when someone adds a medicine. Each rule carries a public source. Nothing is shown until you sign and switch it on."
      />
      <MedicineInteractionRulesPanel />
    </div>
  );
}
