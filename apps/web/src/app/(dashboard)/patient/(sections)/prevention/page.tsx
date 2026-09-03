import Link from "next/link";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { shouldOfferCycleTracking } from "@/lib/patient/cycle-relevance";
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
import { DevelopmentalScreeningCard } from "@/app/(dashboard)/patient/developmental-screening-card";

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
  const { profile, subjectId, subjectSex, subjectDateOfBirth } = await getPatientDashboardContext();

  // The screening calendar and lab-request coordination are free to every
  // patient since the pay-per-service rework — neither costs clinician time.
  // Kept as a named constant rather than deleted so the downstream layout
  // reads the same, and so re-gating it later is a one-line change.
  const screeningBookingEnabled = true;

  const location = { state: profile.state, city: profile.city, area: profile.area };
  const ageYears = ageFromDateOfBirth(profile.date_of_birth);
  // Distinct from ageYears above (the CALLER's own age, used for the "Me"
  // family-vaccination tab): the Child health tab below is about whichever
  // record is actually open, which is the acting-for subject's, not the
  // caller's own, when a parent has opened a child's account.
  const subjectAgeYears = ageFromDateOfBirth(subjectDateOfBirth);

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
      anchorIds: ["risk-assessment"],
      content: (
        <div id="risk-assessment" className="grid scroll-mt-24 grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <RiskAssessmentForm patientId={subjectId} />
            <RiskAssessmentDisplay patientId={subjectId} />
            <FindriscCheck />
          </div>
          <CareProgrammeRecommendations
            patientId={subjectId}
            conditionLanguagePreference={profile.condition_language_preference}
          />
        </div>
      ),
    },
    // Only for a child/adolescent subject — a screening aid whose age-banded
    // item bank tops out at 60 months (developmental-screening-card.tsx
    // self-gates on that; the age check here just keeps the tab itself from
    // showing up empty for an adult patient).
    ...(subjectAgeYears !== null && subjectAgeYears < 18
      ? [
          {
            id: "child-health",
            label: "Child health",
            content: (
              <div className="space-y-6">
                <DevelopmentalScreeningCard
                  patientId={subjectId}
                  organisationId={profile.organisation_id}
                  dateOfBirth={subjectDateOfBirth}
                />
              </div>
            ),
          } satisfies PreventionTab,
        ]
      : []),
    {
      id: "programmes",
      label: "Programmes",
      content: (
        <div className="space-y-6">
          <PreventionCampaignsCard patientId={subjectId} />
          <PreventiveProgrammes patientId={subjectId} ageYears={ageYears} sex={profile.sex} />
          {/* Permissive on an unrecorded sex, deliberately: see
              shouldOfferCycleTracking. The strict `=== "female"` test this
              replaces left the cycle tracker with no entry point at all for
              the majority of accounts, which carry no recorded sex. */}
          {shouldOfferCycleTracking(subjectSex) && profile.organisation_id && (
            <ReproductiveHealthCard patientId={subjectId} organisationId={profile.organisation_id} />
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
