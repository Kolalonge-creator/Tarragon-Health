import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { SubscriptionManager } from "./subscription-manager";

export default async function PatientSubscriptionPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "patient") {
    redirect("/");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My services"
        icon={SEMANTIC_ICON.billing}
        description="One-off purchases covering a fixed window each. Nothing auto-renews. Buy again any time to extend."
      />
      <SubscriptionManager />
    </div>
  );
}
