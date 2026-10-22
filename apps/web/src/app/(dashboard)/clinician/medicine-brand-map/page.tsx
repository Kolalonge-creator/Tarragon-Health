import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { BrandMapPanel } from "./brand-map-panel";

export const metadata = { title: "Medicine brand names" };

/** Clinicians enter, import and review brand-to-ingredient mappings (S08y). Born empty. A clinician cannot approve their own entry. */
export default async function ClinicianMedicineBrandMapPage() {
  const staff = await getCurrentClinicalStaff();
  if (!staff) redirect("/clinician");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medicine brand names"
        description="Brand name to active ingredient, each with a public source. Approved rows help patients find a medicine and power the same-ingredient warning."
      />
      <BrandMapPanel canReview />
    </div>
  );
}
