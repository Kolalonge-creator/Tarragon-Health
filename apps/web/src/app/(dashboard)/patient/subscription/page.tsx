import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Your subscription</h1>
        <p className="text-charcoal-ink/60">
          Manage your plan and add-on services. You can change or cancel any time.
        </p>
      </div>
      <SubscriptionManager />
    </div>
  );
}
