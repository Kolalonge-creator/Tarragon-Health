import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { FeedbackQueueManager } from "./feedback-queue-manager";

export default async function HealthEducationFeedbackPage() {
  const profile = await getCurrentProfile();

  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health education feedback"
        description='Patient reactions on individual content items (docs Module 20 §20.15). "Report incorrect information" is the one that needs clinical follow-up.'
        backTo={{ href: "/admin/settings/health-education", label: "Health education library" }}
      />
      <FeedbackQueueManager />
    </div>
  );
}
