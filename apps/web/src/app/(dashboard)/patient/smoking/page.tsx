import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Smoking"
        icon={SEMANTIC_ICON.smoking}
        backTo={{ href: "/patient/lifestyle", label: "Lifestyle coaching" }}
        description="Whether you're thinking about quitting, mid-quit, or just want to keep track: this is yours to log, and your care team can support you along the way."
      />
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <SmokingClient patientId={profile.id} />
      </RequiresEntitlement>
    </div>
  );
}
