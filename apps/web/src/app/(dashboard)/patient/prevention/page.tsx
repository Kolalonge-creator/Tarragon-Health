import Link from "next/link";
import { redirect } from "next/navigation";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { AnnualHealthCheckBooking } from "../annual-health-check-booking";
import { PreventiveScreeningCalendar } from "../preventive-screening-calendar";
import { PreventiveProgrammes } from "../preventive-programmes";
import { RiskAssessmentForm } from "../risk-assessment-form";
import { RiskAssessmentDisplay } from "../risk-assessment-display";
import { VaccinationRegistry } from "../vaccination-registry";
import { VaccinationBooking } from "../vaccination-booking";
import { LogVaccinationForm } from "../log-vaccination-form";
import { HealthEducation } from "../health-education";
import { AnnualReviewCard } from "../annual-review-card";

/**
 * The prevention hub — one destination for everything that keeps a healthy
 * person healthy: the yearly Health Check journey, the Annual Health Check
 * booking, the personal screening calendar, preventive programmes,
 * vaccinations, and learning. Pure composition over the same components the
 * dashboard renders (same entitlement gates, same RLS) — no new data paths.
 */
export default async function PreventionHubPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

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
          yearly checks that keep healthy people healthy — all in one place, built around
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
            screenings, and immunisations — reviewed by a doctor at the end.
          </p>
          <Link href="/patient/health-check" className="text-sm text-brand-green hover:underline">
            Open this year&apos;s Health Check →
          </Link>
        </CardContent>
      </Card>

      <AnnualHealthCheckBooking
        patientId={profile.id}
        organisationId={profile.organisation_id}
        patientLocation={location}
      />

      <PreventiveScreeningCalendar
        patientId={profile.id}
        organisationId={profile.organisation_id}
        bookingEnabled={screeningBookingEnabled}
        patientLocation={location}
      />
      {!screeningBookingEnabled && <UpgradePrompt feature="prevention_coordination" />}

      <PreventiveProgrammes
        patientId={profile.id}
        ageYears={ageFromDateOfBirth(profile.date_of_birth)}
        sex={profile.sex}
      />

      <RiskAssessmentForm patientId={profile.id} />
      <RiskAssessmentDisplay patientId={profile.id} />

      <VaccinationRegistry
        patientId={profile.id}
        ageYears={ageFromDateOfBirth(profile.date_of_birth)}
      />
      <VaccinationBooking patientId={profile.id} patientLocation={location} />
      <LogVaccinationForm patientId={profile.id} />

      <RequiresEntitlement
        feature="annual_review"
        fallback={<UpgradePrompt feature="annual_review" />}
      >
        <AnnualReviewCard patientId={profile.id} />
      </RequiresEntitlement>

      {profile.organisation_id && (
        <RequiresEntitlement
          feature="health_education"
          fallback={<UpgradePrompt feature="health_education" />}
        >
          <HealthEducation patientId={profile.id} organisationId={profile.organisation_id} />
        </RequiresEntitlement>
      )}
    </div>
  );
}
