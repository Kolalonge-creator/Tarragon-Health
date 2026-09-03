import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ExerciseClient } from "./exercise-client";

/** Exercise programmes + safety (spec §18.5/§18.6). A beginner programme
 * (walking, mobility) is open to everyone; a moderate or vigorous one needs
 * a pre-exercise readiness screen — enforced by a DB trigger
 * (private.enforce_exercise_readiness), never assumed safe by this page. */
export default async function ExercisePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <DashboardPlaceholder greeting="Exercise programmes" roleLabel="Patient" comingUp={[]} icon={SEMANTIC_ICON.exerciseProgramme}>
      <div className="flex justify-end">
        <Link href="/patient/lifestyle" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
          ← Back to lifestyle coaching
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        Structured plans to build activity safely: a walking programme is open to anyone; anything
        more intensive asks a few safety questions first.
      </p>
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <ExerciseClient patientId={profile.id} />
      </RequiresEntitlement>
    </DashboardPlaceholder>
  );
}
