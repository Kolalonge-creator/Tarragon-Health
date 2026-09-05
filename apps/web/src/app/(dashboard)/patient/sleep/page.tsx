import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { SleepClient } from "./sleep-client";

/** Sleep tracking (spec §18.11) — duration, quality, routine, daytime
 * sleepiness, and a sleep goal. See the sleep_tracking migration for why
 * this is a standalone tracker; a very short night with high daytime
 * sleepiness routes to a clinician (apps/web/src/lib/sleep/escalate.ts). */
export default async function SleepPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sleep"
        icon={SEMANTIC_ICON.sleep}
        backTo={{ href: "/patient/lifestyle", label: "Lifestyle coaching" }}
        description="Log how you're sleeping: duration, quality, and how alert you feel during the day."
      />
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <SleepClient patientId={profile.id} />
      </RequiresEntitlement>
    </div>
  );
}
