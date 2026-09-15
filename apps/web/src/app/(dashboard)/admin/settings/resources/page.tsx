import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ResourcesManager } from "./resources-manager";

export default async function AdminResourcesPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resources"
        description="The education and content library patients see across the app and marketing site."
      />
      <ResourcesManager />
    </div>
  );
}
