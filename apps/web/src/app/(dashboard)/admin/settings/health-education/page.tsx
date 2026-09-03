import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { HealthEducationManager } from "./health-education-manager";

export default async function HealthEducationSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from any /admin/** route at the routing
  // layer — this is defense-in-depth, matching the other admin settings pages.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health education library"
        description="The clinician-reviewed learning catalogue surfaced to every patient; the education library is free for everyone under the pay-per-service model. Content is personalised to each patient's active conditions and risk. Toggle an item live or hidden here; authoring the body and knowledge check is done via seed/migration for now."
      />
      <HealthEducationManager />
    </div>
  );
}
