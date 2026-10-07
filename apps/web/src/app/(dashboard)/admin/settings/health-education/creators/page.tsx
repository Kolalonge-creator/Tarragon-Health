import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { CreatorsManager } from "./creators-manager";

export const metadata = { title: "Learning creators" };

export default async function Page() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Learning creators"
        description="Invite-only clinician creators: verification, credit by name and suspension. Revenue share is not built."
        backTo={{ href: "/admin/settings/health-education", label: "Health education library" }}
      />
      <CreatorsManager />
    </div>
  );
}
