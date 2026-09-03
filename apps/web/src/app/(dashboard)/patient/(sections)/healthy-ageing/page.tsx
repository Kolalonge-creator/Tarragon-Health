import Link from "next/link";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { NAV_ICON } from "@/lib/icons";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { HealthyAgeingSnapshotTile } from "@/app/(dashboard)/patient/healthy-ageing-snapshot-tile";
import { CoordinatedCareSummaryCard } from "@/app/(dashboard)/patient/coordinated-care-summary-card";
import { AgeingAssessmentSection } from "@/app/(dashboard)/patient/ageing-assessment-section";
import { FallsRiskSection } from "@/app/(dashboard)/patient/falls-risk-section";
import { SocialDeterminantsSection } from "@/app/(dashboard)/patient/social-determinants-section";
import { HomeCareRequestSection } from "@/app/(dashboard)/patient/home-care-request-section";

/** Age most platforms and Nigeria's own senior-citizens framing treat as
 * "older adult" — a soft threshold for framing copy only, never a hard gate:
 * a caregiver acting for an older relative, or a younger patient with real
 * risk factors, both need full access to this page. */
const HEALTHY_AGEING_AGE_THRESHOLD = 60;

export default async function HealthyAgeingPage() {
  const { profile, subjectId } = await getPatientDashboardContext();
  const ageYears = ageFromDateOfBirth(profile.date_of_birth);
  const isOlderAdult = ageYears == null || ageYears >= HEALTHY_AGEING_AGE_THRESHOLD;

  return (
    <DashboardSection
      id="healthy-ageing"
      title="Healthy ageing"
      description={
        isOlderAdult
          ? "Independence, prevention, and coordinated care, not just a list of conditions."
          : "Built with older adults and the people who care for them in mind, and still useful for anyone tracking mobility, falls risk, or support at home."
      }
      icon={NAV_ICON.healthyAgeing}
    >
      <HealthyAgeingSnapshotTile patientId={subjectId} />
      <CoordinatedCareSummaryCard patientId={subjectId} />
      <AgeingAssessmentSection patientId={subjectId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FallsRiskSection patientId={subjectId} />
        <SocialDeterminantsSection patientId={subjectId} />
      </div>

      <VitalsTrendChart patientId={subjectId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HomeCareRequestSection patientId={subjectId} />

        <div className="rounded-lg border border-charcoal-ink/10 p-4">
          <p className="text-sm font-medium text-charcoal-ink">Related</p>
          <ul className="mt-2 space-y-1.5 text-sm text-brand-green">
            <li>
              <Link href="/patient/emergency-card" className="hover:underline">
                Emergency card: allergies, medicines, and contacts for a stranger to find →
              </Link>
            </li>
            <li>
              <Link href="/patient/lifestyle" className="hover:underline">
                Nutrition and lifestyle coaching →
              </Link>
            </li>
            <li>
              <Link href="/patient/prevention#vaccinations" className="hover:underline">
                Vaccinations and preventive screening →
              </Link>
            </li>
            <li>
              <Link href="/patient/family" className="hover:underline">
                Caregivers who can help manage this →
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </DashboardSection>
  );
}
