import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { HealthEducationLibrary } from "@/app/(dashboard)/patient/health-education";

/**
 * The patient-facing health library: a top-level destination (not a tab
 * buried inside Prevention) covering chronic conditions, prevention,
 * everyday wellness, and using Tarragon well — a couple hundred articles
 * across 14 browsable categories, not just whatever the personalisation
 * algorithm decided was relevant to a patient's own diagnoses. See
 * health-education.tsx for the "Recommended for you" rail (personalised,
 * paced) sitting above the full, ungated browse-by-category library.
 */
export default async function LearnPage() {
  const { profile, subjectId } = await getPatientDashboardContext();

  if (!profile.organisation_id) {
    return null;
  }
  const organisationId = profile.organisation_id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Learn"
        icon={SEMANTIC_ICON.learn}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description="Clear, plain-language reading on your conditions and on staying healthy generally, written to take you from not knowing to actually understanding. Browse by topic, or start with what's recommended for you."
      />
      <HealthEducationLibrary
        patientId={subjectId}
        organisationId={organisationId}
        conditionLanguagePreference={profile.condition_language_preference}
      />
    </div>
  );
}
