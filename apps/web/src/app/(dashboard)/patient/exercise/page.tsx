import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Exercise programmes"
        icon={SEMANTIC_ICON.exerciseProgramme}
        backTo={{ href: "/patient/lifestyle", label: "Lifestyle coaching" }}
        description="Structured plans to build activity safely: a walking programme is open to anyone; anything more intensive asks a few safety questions first."
      />
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <ExerciseClient patientId={profile.id} />
      </RequiresEntitlement>
    </div>
  );
}
