import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
        description="Follow your weight against a goal you set. You can record your weight with your vitals or in your lifestyle check-in, and either way it appears here."
      />
      <WeightClient patientId={profile.id} />
    </div>
  );
}
