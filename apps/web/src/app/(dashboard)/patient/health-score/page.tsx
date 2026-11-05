import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { HealthDomainsCard } from "@/app/(dashboard)/patient/health-domains-card";

/**
 * Your health by area (T2-06, founder 2026-11-04). This route used to show the composite Health Score and its trend; the founder replaced
 * the composite with per-domain status, trends and outstanding actions until a score is clinically validated. The URL is kept so existing
 * links still land somewhere useful. The score history stays in patient_risk_scores; it is simply no longer presented.
 */
export default async function HealthScorePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your health by area"
        icon={SEMANTIC_ICON.preventive}
        backTo={{ href: "/patient", label: "Overview" }}
        description="Your results and readings grouped by area, with the range each is compared with and which way it has moved."
      />
      <HealthDomainsCard patientId={profile.id} canViewReproductive />
    </div>
  );
}
