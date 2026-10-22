import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { NutritionGuidanceConfigPanel } from "../_signoff-panels/nutrition-guidance-config-panel";

/** The Chief Medical Officer's own path to sign the food swaps and the five eating plans (S50a). The database refuses anyone else. */
export default async function ClinicianNutritionGuidanceConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Eating plans and food swaps" description="Off for every patient until signed." />
      <NutritionGuidanceConfigPanel />
    </div>
  );
}
