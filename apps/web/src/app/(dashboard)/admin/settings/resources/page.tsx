import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ResourcesManager } from "./resources-manager";

export default async function AdminResourcesPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Resources</h1>
        <p className="text-charcoal-ink/60">
          The education and content library patients see across the app and marketing site.
        </p>
      </div>
      <ResourcesManager />
    </div>
  );
}
