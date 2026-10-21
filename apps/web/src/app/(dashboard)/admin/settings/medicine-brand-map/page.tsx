import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { BrandMapPanel } from "../../../clinician/medicine-brand-map/brand-map-panel";

export const metadata = { title: "Medicine brand names" };

/** Admin view: add and import rows. An admin cannot review; a clinician does that from their own console. */
export default async function MedicineBrandMapSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medicine brand names"
        description="Add or import brand-to-ingredient rows, each with a public source. A clinician reviews them before they are used."
      />
      <BrandMapPanel canReview={false} />
    </div>
  );
}
