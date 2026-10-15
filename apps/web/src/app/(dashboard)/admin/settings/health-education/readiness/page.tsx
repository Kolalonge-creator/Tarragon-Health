import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ReadinessManager } from "./readiness-manager";

export const metadata = { title: "Learning content readiness" };

export default async function Page() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Learning content readiness"
        description="What weakens the library: published items missing a reviewer, a review date, a source or a self-care step, and the draft placeholders waiting for a clinical author."
        backTo={{ href: "/admin/settings/health-education", label: "Health education library" }}
      />
      <ReadinessManager />
    </div>
  );
}
