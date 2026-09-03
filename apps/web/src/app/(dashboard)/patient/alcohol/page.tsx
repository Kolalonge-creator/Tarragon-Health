import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { AlcoholClient } from "./alcohol-client";

/** Alcohol consumption tracking + reduction goal (spec §18.10). AUDIT-C
 * screening itself already exists (mental_health_screens, /patient/health-
 * check) and is left untouched — this adds the tracked-over-time piece that
 * was missing: a weekly reduction target and a per-day drinks log. */
export default async function AlcoholPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <DashboardPlaceholder greeting="Alcohol" roleLabel="Patient" comingUp={[]} icon={SEMANTIC_ICON.alcohol}>
      <div className="flex justify-end">
        <Link href="/patient/lifestyle" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
          ← Back to lifestyle coaching
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        Track how much you&apos;re drinking and set a goal to cut back, at your own pace.
      </p>
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <AlcoholClient patientId={profile.id} />
      </RequiresEntitlement>
    </DashboardPlaceholder>
  );
}
