import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { AnalyticsManager } from "./analytics-manager";

export default async function ReproductiveHealthAnalyticsPage() {
  const profile = await getCurrentProfile();

  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reproductive health analytics"
        description="Aggregate, de-identified reproductive-health and menstrual-cycle-tracking stats for internal research — never a per-patient figure, and every number below a 10-person floor is withheld rather than shown as zero."
        backTo={{ href: "/admin/settings", label: "Settings" }}
      />
      <AnalyticsManager />
    </div>
  );
}
