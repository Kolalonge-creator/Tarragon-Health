import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { LogisticsPartnersManager } from "./logistics-partners-manager";

export default async function LogisticsPartnersSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // Super admin, or a member delegated home-visit or logistics management.
  if (!(await hasAnyPermission("partners.home_visit.manage", "partners.logistics.manage"))) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Home visit & delivery partners"
        description="There is no feature flag for home collection or delivery. Patients see a real scheduling/tracking UI the moment an active partner row exists covering their region. Adding or activating a row below is the entire mechanism."
      />
      <LogisticsPartnersManager />
    </div>
  );
}
