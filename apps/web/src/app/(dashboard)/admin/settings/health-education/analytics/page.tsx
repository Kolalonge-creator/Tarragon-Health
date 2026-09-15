import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { AnalyticsManager } from "./analytics-manager";

export default async function HealthEducationAnalyticsPage() {
  const profile = await getCurrentProfile();

  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health education analytics"
        description="Content viewed, completion, quiz performance, and patient feedback per catalogue item (docs Module 20 §20.18)."
        backTo={{ href: "/admin/settings/health-education", label: "Health education library" }}
      />
      <AnalyticsManager />
    </div>
  );
}
