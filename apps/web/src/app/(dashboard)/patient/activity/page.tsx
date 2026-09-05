import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        icon={SEMANTIC_ICON.steps}
        backTo={{ href: "/patient/lifestyle", label: "Lifestyle coaching" }}
        description={
          <>
            Log your steps and workouts, or connect a wearable on your{" "}
            <Link href="/patient/vitals" className="text-brand-green dark:text-brand-green-bright underline hover:no-underline">
              Vitals page
            </Link>{" "}
            to have them sync automatically.
          </>
        }
      />
      <ActivityClient patientId={profile.id} />
    </div>
  );
}
