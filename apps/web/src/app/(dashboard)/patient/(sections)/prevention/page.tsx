import Link from "next/link";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { HealthEducation } from "@/app/(dashboard)/patient/health-education";
import { AnnualReviewCard } from "@/app/(dashboard)/patient/annual-review-card";

/**
 * The prevention hub — one destination for everything that keeps a healthy
 * person healthy: the yearly Health Check journey, the Annual Health Check
 * booking, the personal screening calendar, preventive programmes,
 * vaccinations, and learning. Pure composition over the same components the
 * dashboard renders (same entitlement gates, same RLS) — no new data paths.
 * Was previously reachable two ways with two independently-resolved contexts
 * (this standalone route, and a near-duplicate "Prevention" section on the
 * old single-page /patient dashboard) — the dashboard restructure retired the
 * duplicate and folded its two extra pieces (CareProgrammeRecommendations,
 * ReproductiveHealthCard) and its richer family-aware vaccination component
 * in here, so this is now the one real implementation.
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold text-charcoal-ink">
          <SEMANTIC_ICON.preventive className="h-6 w-6 text-deep-forest" strokeWidth={2} />
          Prevention
        </h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          You don&apos;t need to be unwell to be here. Screenings, vaccinations, and the
          yearly checks that keep healthy people healthy: all in one place, built around
          your age, sex, and history.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your yearly Health Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-charcoal-ink/70">
            A guided, whole-body check-in: your health profile, wellbeing, measurements,
            screenings, and immunisations, reviewed by a doctor at the end.
          </p>
          <Link href="/patient/health-check" className="text-sm text-brand-green hover:underline">
            Open this year&apos;s Health Check →
          </Link>
        </CardContent>
      </Card>

      {/* #health-check is where somebody who signed up specifically to book a
          one-off check is sent after onboarding (see completeOnboarding), so
          the first thing they see is the thing they came for. */}
      <div id="health-check" className="scroll-mt-24">
        <AnnualHealthCheckBooking
          patientId={subjectId}
          organisationId={profile.organisation_id}
          sex={profile.sex}
          screensEnabled={screeningBookingEnabled}
        />
      </div>

      <ResultsTrendsCard patientId={subjectId} />

      {/* Anchor ids are the Health Check journey's stage-link targets
          (/patient/prevention#screenings etc.) — keep in sync with
          health-check/page.tsx. scroll-mt clears the sticky app-shell chrome. */}
      <div id="screenings" className="scroll-mt-24 space-y-6">
        <PreventiveScreeningCalendar
          patientId={subjectId}
          organisationId={profile.organisation_id}
          bookingEnabled={screeningBookingEnabled}
        />
        {!screeningBookingEnabled && <UpgradePrompt feature="prevention_coordination" />}
      </div>

      <PreventiveProgrammes
        patientId={subjectId}
        ageYears={ageFromDateOfBirth(profile.date_of_birth)}
        sex={profile.sex}
      />

      <CareProgrammeRecommendations
        patientId={subjectId}
        conditionLanguagePreference={profile.condition_language_preference}
      />

      {profile.sex === "female" && profile.organisation_id && (
        <ReproductiveHealthCard patientId={subjectId} organisationId={profile.organisation_id} />
      )}

      <div id="risk-assessment" className="scroll-mt-24 space-y-6">
        <RiskAssessmentForm patientId={subjectId} />
        <RiskAssessmentDisplay patientId={subjectId} />
        <FindriscCheck />
      </div>

      <div id="vaccinations" className="scroll-mt-24 space-y-6">
        <VaccinationForFamily
          self={{
            id: subjectId,
            label: "Me",
            ageYears: ageFromDateOfBirth(profile.date_of_birth),
            dateOfBirth: profile.date_of_birth,
            sex: profile.sex,
          }}
          patientLocation={location}
        />
      </div>

      {/* Annual Doctor Review is retired as a standalone product — folded into
          Comprehensive Screen. No entitlement gate: renders only for a
          pre-existing in-progress row, nothing for everyone else. */}
      <AnnualReviewCard patientId={subjectId} />

      {profile.organisation_id && (
        <RequiresEntitlement
          feature="health_education"
          fallback={<UpgradePrompt feature="health_education" />}
        >
          <HealthEducation
            patientId={subjectId}
            organisationId={profile.organisation_id}
            conditionLanguagePreference={profile.condition_language_preference}
          />
        </RequiresEntitlement>
      )}
    </div>
  );
}
