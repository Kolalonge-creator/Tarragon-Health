import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { HealthScoreTrendClient } from "./health-score-trend-client";

/**
 * Full trend view for the Health Score — reached from "See your trend over time" on
 * HealthScoreCard. Same auth/redirect shape as /patient/weight and
 * /patient/biological-age; no entitlement gate, since the Health Score card it's
 * reached from has none either (free-tier-visible). Unlike /patient/biological-age,
 * this route needs no feature-flag gate — the Health Score itself has been fully
 * shipped since v1, only the age reframe of it is what's still pending sign-off.
 */
export default async function HealthScorePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health Score"
        icon={SEMANTIC_ICON.preventive}
        backTo={{ href: "/patient", label: "Overview" }}
        description="How your score has moved over time, and what's feeding it."
      />
      <HealthScoreTrendClient patientId={profile.id} />
    </div>
  );
}
