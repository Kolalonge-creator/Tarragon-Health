import Link from "next/link";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { AnnualHealthCheckBooking } from "@/app/(dashboard)/patient/annual-health-check-booking";
import { ResultsTrendsCard } from "@/app/(dashboard)/patient/results-trends-card";
import { PreventiveScreeningCalendar } from "@/app/(dashboard)/patient/preventive-screening-calendar";
import { PreventiveProgrammes } from "@/app/(dashboard)/patient/preventive-programmes";
import { CareProgrammeRecommendations } from "@/app/(dashboard)/patient/care-programme-recommendations";
import { ReproductiveHealthCard } from "@/app/(dashboard)/patient/reproductive-health-card";
import { RiskAssessmentForm } from "@/app/(dashboard)/patient/risk-assessment-form";
import { RiskAssessmentDisplay } from "@/app/(dashboard)/patient/risk-assessment-display";
import { FindriscCheck } from "@/app/(dashboard)/patient/findrisc-check";
import { VaccinationForFamily } from "@/app/(dashboard)/patient/vaccination-for-family";
import { PreventionTabs, type PreventionTab } from "@/app/(dashboard)/patient/prevention-tabs";
import { PreventionCampaignsCard } from "@/app/(dashboard)/patient/prevention-campaigns-card";
import { FeatureAnchor } from "@/components/patient/feature-anchor";
import { getPatientSignals } from "@/lib/patient/feature-signals";
import { getFeature, isFeatureRelevant } from "@/lib/patient/feature-registry";

/**
 * The prevention hub — one destination for everything that keeps a healthy
 * person healthy: the yearly Health Check journey, the Annual Health Check
 * booking, the personal screening calendar, preventive programmes, and
 * vaccinations. Pure composition over the same components the dashboard
 * renders (same entitlement gates, same RLS) — no new data paths.
 *
 * Health education used to live here as a "Learn" tab; it now has its own
 * top-level "Learn" nav entry (/patient/learn) since it spans chronic care
 * and general wellness topics too, not just prevention — being buried as
 * the last tab of a five-tab hub was part of why patients weren't finding it.
 * Was previously reachable two ways with two independently-resolved contexts
 * (this standalone route, and a near-duplicate "Prevention" section on the
 * old single-page /patient dashboard) — the dashboard restructure retired the
 * duplicate and folded its two extra pieces (CareProgrammeRecommendations,
 * ReproductiveHealthCard) and its richer family-aware vaccination component
 * in here, so this is now the one real implementation.
 *
 * Grouped into tabs (PreventionTabs) rather than one long scroll — patients
 * were missing screenings/vaccinations/risk-assessment content buried below
 * the fold. Anchor ids (#health-check, #screenings, #vaccinations,
 * #risk-assessment) are the Health Check journey's stage-link targets
 * (/patient/prevention#screenings etc., see health-check/page.tsx) and
 * onboarding's redirect target — keep them in sync with PreventionTabs'
 * anchorIds so those deep links keep landing on the right tab.
 */
export default async function PreventionHubPage() {
  const { profile, subjectId } = await getPatientDashboardContext();

  const supabase = await createClient();
  const { data: labCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "lab_coordination",
  });
  const { data: preventionCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "prevention_coordination",
  });
  const screeningBookingEnabled =
    (labCoordinationEnabled ?? false) || (preventionCoordinationEnabled ?? false);

  const location = { state: profile.state, city: profile.city, area: profile.area };
  const ageYears = ageFromDateOfBirth(profile.date_of_birth);

  // Whether to show the cycle card is decided by the SAME predicate the
  // registry uses to decide whether to mention it, rather than by a second,
  // stricter rule living here.
  //
  // They used to disagree, and the disagreement was a dead end: this page
  // required `sex === "female"` exactly, while most accounts have no sex
  // recorded at all (it is not asked for at signup). So a woman whose profile
  // was simply incomplete searched "period", was correctly offered "Cycle and
  // reproductive health", followed it, and landed on a page with no such card
  // and no explanation. A silent nothing is the worst possible answer to
  // somebody who just told us exactly what they wanted.
  //
  // isFeatureRelevant treats an unrecorded signal as permissive on purpose:
  // an empty column is a gap in our record, not a statement about the patient,
  // which is the same null-gating principle reviewed_by and doctor_tier follow.
  // The card itself asks for a life stage and defaults to "prefer not to say",
  // so somebody it does not apply to simply leaves it alone.
  const signals = await getPatientSignals(subjectId);
  const showReproductiveHealth = isFeatureRelevant(getFeature("cycle-tracking")!, signals);

  const tabs: PreventionTab[] = [
    {
      id: "health-check",
      label: "Health Check",
      anchorIds: ["health-check"],
      content: (
        // Where somebody who signed up specifically to book a one-off check
        // is sent after onboarding (see completeOnboarding) — also the
        // default tab, so the first thing they see is the thing they came for.
        <div id="health-check" className="space-y-6">
          <AnnualHealthCheckBooking
            patientId={subjectId}
            organisationId={profile.organisation_id}
            sex={profile.sex}
            state={profile.state}
            screensEnabled={screeningBookingEnabled}
          />
          <ResultsTrendsCard patientId={subjectId} />
        </div>
      ),
    },
    {
      id: "screenings",
      label: "Screenings & Vaccinations",
      anchorIds: ["screenings", "vaccinations"],
      content: (
        <div id="screenings" className="grid scroll-mt-24 grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <PreventiveScreeningCalendar
              patientId={subjectId}
              organisationId={profile.organisation_id}
              bookingEnabled={screeningBookingEnabled}
            />
          </div>

          <div id="vaccinations" className="scroll-mt-24">
            <VaccinationForFamily
              self={{
                id: subjectId,
                label: "Me",
                ageYears,
                dateOfBirth: profile.date_of_birth,
                sex: profile.sex,
              }}
              patientLocation={location}
            />
          </div>
        </div>
      ),
    },
    {
      id: "risk-assessment",
      label: "Risk Assessment",
      anchorIds: ["risk-assessment", "findrisc"],
      content: (
        <div id="risk-assessment" className="grid scroll-mt-24 grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <RiskAssessmentForm patientId={subjectId} />
            <RiskAssessmentDisplay patientId={subjectId} />
            <FeatureAnchor id="findrisc">
              <FindriscCheck />
            </FeatureAnchor>
          </div>
          <CareProgrammeRecommendations
            patientId={subjectId}
            conditionLanguagePreference={profile.condition_language_preference}
          />
        </div>
      ),
    },
    {
      id: "programmes",
      label: "Programmes",
      // Cycle tracking lived in here with no anchor of its own, so nothing
      // outside this file could link to it and a patient reached it only by
      // opening the fourth tab and scrolling. The registry now points at
      // #cycle, which is why these anchorIds matter: PreventionTabs resolves
      // a hash to its owning tab before the browser can try to scroll to a
      // hidden panel (see prevention-tabs.tsx).
      anchorIds: ["programmes", "campaigns", "cycle"],
      content: (
        <div className="space-y-6">
          <FeatureAnchor id="campaigns">
            <PreventionCampaignsCard patientId={subjectId} />
          </FeatureAnchor>
          <FeatureAnchor id="programmes">
            <PreventiveProgrammes patientId={subjectId} ageYears={ageYears} sex={profile.sex} />
          </FeatureAnchor>
          {showReproductiveHealth && profile.organisation_id && (
            <FeatureAnchor id="cycle">
              <ReproductiveHealthCard
                patientId={subjectId}
                organisationId={profile.organisation_id}
              />
            </FeatureAnchor>
          )}
        </div>
      ),
    },
  ];

  return (
    <DashboardSection
      id="prevention"
      title="Prevention"
      description="You don't need to be unwell to be here. Screenings, vaccinations, and the yearly checks that keep healthy people healthy, all built around your age, sex, and history."
      icon={SEMANTIC_ICON.preventive}
    >
      <Card className="border-brand-green/25">
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-soft-sage">
            <SEMANTIC_ICON.preventive className="h-6 w-6 text-deep-forest" strokeWidth={2} />
          </span>
          <div className="flex-1">
            <p className="font-heading text-base font-semibold text-charcoal-ink">
              Your yearly Health Check
            </p>
            <p className="mt-1 text-sm text-charcoal-ink/70">
              A guided, whole-body check-in: your health profile, wellbeing, measurements,
              screenings, and immunisations, reviewed by a doctor at the end.
            </p>
          </div>
          <Link
            href="/patient/health-check"
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-deep-forest"
          >
            Open this year&apos;s Health Check →
          </Link>
        </CardContent>
      </Card>

      <PreventionTabs tabs={tabs} />
    </DashboardSection>
  );
}
