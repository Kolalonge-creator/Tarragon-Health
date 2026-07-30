import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ActivityClient } from "./activity-client";

/**
 * Steps/activity tracking (Omada-style "Today" screen) — manual entry only.
 * Real wearable step counts have no live provider configured yet (see
 * CLAUDE.md "Device & Wearable Integration"); when one lands, it should
 * write into activity_log_entries (entry_type='steps') rather than a
 * separate store, same "no dual source of truth" rule as vitals_readings.
 */
export default async function ActivityPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <DashboardPlaceholder greeting="Activity" roleLabel="Patient" comingUp={[]} icon={SEMANTIC_ICON.steps}>
      <div className="flex justify-end">
        <Link href="/patient/lifestyle" className="text-sm font-medium text-brand-green hover:underline">
          ← Back to lifestyle coaching
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70">
        Log your steps and workouts. There&apos;s no automatic step counter yet — wearable sync is
        coming, but for now this tracks whatever you log yourself.
      </p>
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <ActivityClient patientId={profile.id} />
      </RequiresEntitlement>
    </DashboardPlaceholder>
  );
}
