import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { NutritionTargetsConfigPanel } from "../_signoff-panels/nutrition-targets-config-panel";

/** The Chief Medical Officer's own path to sign the nutrition targets and meal summary numbers (S49a). The database refuses anyone else. */
export default async function ClinicianNutritionTargetsConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader title="Nutrition targets" description="The daily numbers and the word summary lines. Off for every patient until signed." />
      <NutritionTargetsConfigPanel />
    </div>
  );
}
