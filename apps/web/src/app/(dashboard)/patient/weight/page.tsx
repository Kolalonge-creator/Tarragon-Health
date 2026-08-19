import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { WeightClient } from "./weight-client";

/**
 * Weight-goal tracking (Omada-style "Weight" screen) — same entitlement gate
 * as nutrition/lifestyle. Reads/writes the canonical vitals_readings weight
 * history (VitalsTrendChart's own store), plus a patient_weight_goals row
 * for the goal line and progress stats.
 */
export default async function WeightPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weight"
        icon={SEMANTIC_ICON.weight}
        backTo={{ href: "/patient/lifestyle", label: "Lifestyle coaching" }}
        description="Track your weight against a goal you set. Log weight from your vitals or your lifestyle check-in; either way, it shows up here."
      />
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <WeightClient patientId={profile.id} />
      </RequiresEntitlement>
    </div>
  );
}
