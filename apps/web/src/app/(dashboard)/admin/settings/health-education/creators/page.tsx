import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { CreatorAdmin } from "@/components/learning/creator-admin";

export const metadata = { title: "Clinician creators" };

export default async function LearningCreatorsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinician creators"
        description="Approve or suspend verified clinicians who write Members-only learning series."
        backTo={{ href: "/admin/settings/health-education", label: "Health education library" }}
      />
      <CreatorAdmin />
    </div>
  );
}
