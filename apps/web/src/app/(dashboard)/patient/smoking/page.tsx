import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { SmokingClient } from "./smoking-client";

/** Smoking cessation tracking (spec §18.9) — status, quit plan, daily
 * check-ins, and progress. See the smoking_cessation_tracking migration for
 * why this is a standalone tracker rather than folded into the Lifestyle
 * Programme Engine. */
export default async function SmokingPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <DashboardPlaceholder greeting="Smoking" roleLabel="Patient" comingUp={[]} icon={SEMANTIC_ICON.smoking}>
      <div className="flex justify-end">
        <Link href="/patient/lifestyle" className="text-sm font-medium text-brand-green hover:underline">
          ← Back to lifestyle coaching
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70">
        Whether you&apos;re thinking about quitting, mid-quit, or just want to keep track: this is
        yours to log, and your care team can support you along the way.
      </p>
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <SmokingClient patientId={profile.id} />
      </RequiresEntitlement>
    </DashboardPlaceholder>
  );
}
