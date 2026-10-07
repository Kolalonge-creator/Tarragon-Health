import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Alcohol"
        icon={SEMANTIC_ICON.alcohol}
        backTo={{ href: "/patient/lifestyle", label: "Lifestyle coaching" }}
        description="Track how much you're drinking and set a goal to cut back, at your own pace."
      />
      <AlcoholClient patientId={profile.id} />
    </div>
  );
}
