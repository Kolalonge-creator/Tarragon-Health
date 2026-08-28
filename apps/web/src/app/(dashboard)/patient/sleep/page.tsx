import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
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
    <DashboardPlaceholder greeting="Sleep" roleLabel="Patient" comingUp={[]} icon={SEMANTIC_ICON.sleep}>
      <div className="flex justify-end">
        <Link href="/patient/lifestyle" className="text-sm font-medium text-brand-green hover:underline">
          ← Back to lifestyle coaching
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70">
        Log how you&apos;re sleeping — duration, quality, and how alert you feel during the day.
      </p>
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <SleepClient patientId={profile.id} />
      </RequiresEntitlement>
    </DashboardPlaceholder>
  );
}
