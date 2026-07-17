import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { LifestyleFlow } from "../lifestyle-flow";

export default async function LifestylePage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <DashboardPlaceholder
      greeting="Lifestyle coaching"
      roleLabel="Patient"
      comingUp={[]}
    >
      <div className="flex justify-end">
        <Link href="/patient" className="text-sm font-medium text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70">
        Small, steady changes to how you eat, move, sleep and manage stress — guided by your care
        team. Set goals, follow a programme, and get a progress review every few months.
      </p>
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <LifestyleFlow patientId={profile.id} />
      </RequiresEntitlement>
    </DashboardPlaceholder>
  );
}
