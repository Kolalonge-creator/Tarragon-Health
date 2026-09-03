import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ActivityClient } from "./activity-client";

/**
 * Steps/activity tracking (Omada-style "Today" screen). A connected wearable
 * (Connect card on the Vitals page) syncs its step counts straight into
 * activity_log_entries (entry_type='steps', source='wearable') via
 * lib/wearables/ingest.ts's recordStepDays — same table and meter a manual
 * "log my steps" entry writes to, per the "no dual source of truth" rule.
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
        Log your steps and workouts, or connect a wearable on your{" "}
        <Link href="/patient/vitals" className="text-brand-green underline hover:no-underline">
          Vitals page
        </Link>{" "}
        to have them sync automatically.
      </p>
      <ActivityClient patientId={profile.id} />
    </DashboardPlaceholder>
  );
}
