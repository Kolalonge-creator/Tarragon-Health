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
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">My services</h1>
        <p className="text-charcoal-ink/60">
          One-off purchases covering a fixed window each. Nothing auto-renews. Buy again any time to extend.
        </p>
      </div>
      <SubscriptionManager />
    </div>
  );
}
