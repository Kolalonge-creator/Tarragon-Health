import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { createClient } from "@/lib/supabase/server";
import { hasCoachAccess } from "@/lib/ai-coach/entitlement";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { MyCarePlanTasks } from "@/app/(dashboard)/patient/my-care-plan-tasks";
import { ChronicProgrammeTimeline } from "@/app/(dashboard)/patient/chronic-programme-timeline";
import { PregnancyStatus } from "@/app/(dashboard)/patient/pregnancy-status";
import { ObesitySummary } from "@/app/(dashboard)/patient/obesity-summary";
import { AskADoctor } from "@/app/(dashboard)/patient/ask-a-doctor";
import { SecondOpinionRequestCard } from "@/app/(dashboard)/patient/second-opinion-request";
import { VerifiedDocumentsCard } from "@/app/(dashboard)/patient/verified-documents-card";
import { SeniorCaseReviewCard } from "@/app/(dashboard)/patient/senior-case-review-card";
import { BookVideoVisit } from "@/app/(dashboard)/patient/book-video-visit";
import { PatientEscalations } from "@/components/patient-escalations";
import { HospitalAdmissionsCard } from "@/app/(dashboard)/patient/hospital-admissions-card";
import { LifestyleProgressSummary } from "@/app/(dashboard)/patient/lifestyle-progress-summary";
import { YourReferrals } from "@/components/your-referrals";
import { NavigationRequests } from "@/app/(dashboard)/patient/navigation-requests";
import { AiCoachChat } from "@/app/(dashboard)/patient/ai-coach-chat";
import { ServiceNavigationAssistant } from "@/app/(dashboard)/patient/service-navigation-assistant";
import { CareCircleCard } from "@/app/(dashboard)/patient/care-circle-card";
import { CareVouchersCard } from "@/components/care-vouchers-card";
import { WellnessPointsSummary } from "@/app/(dashboard)/patient/wellness-points-summary";
import { GoalsAndMilestonesCard } from "@/app/(dashboard)/patient/goals-and-milestones-card";
import { TestimonialForm } from "@/components/testimonial-form";

export default async function PatientCarePage() {
  const { profile, subjectId } = await getPatientDashboardContext();
  const supabase = await createClient();
  const coachAccess = await hasCoachAccess(supabase);
  const { data: asyncDoctorVisitPlanAccess } = await supabase.rpc("has_feature_access", {
    feature: "async_doctor_visit",
  });

  return (
    <DashboardSection
      id="care"
      title="Care & support"
      description="Your care plan, reviews, and referrals."
      icon={SEMANTIC_ICON.clinicianFollowUp}
    >
      {/* Clinical and functional cards first — this is where a patient
          checking in on their care actually needs to land. Messaging
          itself now lives in Overview (see above); wellness/vouchers/
          testimonial cards, being discretionary rather than clinical, sit
          below everything here so they never compete with care content
          (2026-07-30 patient-experience pass). */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <RequiresEntitlement feature="clinician_review" fallback={<UpgradePrompt feature="clinician_review" />}>
            <MyCarePlanTasks patientId={subjectId} organisationId={profile.organisation_id} />
            <ObesitySummary
              patientId={subjectId}
              conditionLanguagePreference={profile.condition_language_preference}
            />
          </RequiresEntitlement>
          {/* Not entitlement-gated: self-monitoring is the free, system-only
              default track of the 12-week chronic-care programme — it must
              never require a paid plan. The doctor-supported add-on is sold
              from inside the card itself. */}
          {profile.organisation_id && (
            <ChronicProgrammeTimeline patientId={subjectId} organisationId={profile.organisation_id} />
          )}
          {/* Not entitlement-gated: the obstetric-led guard (§20.2) needs to
              fire for anyone on a diabetes care plan regardless of tier, and
              self-reporting pregnancy shouldn't require a paid plan. Renders a
              plain status card for everyone else. */}
          <PregnancyStatus patientId={subjectId} />
          <PatientEscalations patientId={subjectId} />
          <HospitalAdmissionsCard patientId={subjectId} />
          {/* Not entitlement-gated: lifestyle coaching is free to every
              patient since the pay-per-service rework. */}
          <LifestyleProgressSummary patientId={subjectId} />
        </div>

        <div className="space-y-4">
          {/* Paid per-visit service — no plan gate; the card itself carries the
              availability + not-for-emergencies copy. */}
          <BookVideoVisit patientId={subjectId} />
          {/* Paid per-question service — no hard plan gate; a patient without
              async_doctor_visit on their plan can still buy a one-off
              credit, the card itself offers that. */}
          <AskADoctor
            patientId={subjectId}
            organisationId={profile.organisation_id}
            hasPlanAccess={Boolean(asyncDoctorVisitPlanAccess)}
          />
          {/* Pure pay-per-service — no plan bypass, the card carries its own
              buy-a-credit prompt. */}
          <SecondOpinionRequestCard patientId={subjectId} organisationId={profile.organisation_id} />
          <VerifiedDocumentsCard patientId={subjectId} organisationId={profile.organisation_id} />
          <SeniorCaseReviewCard patientId={subjectId} organisationId={profile.organisation_id} />
          {coachAccess && <AiCoachChat patientId={subjectId} />}
          <ServiceNavigationAssistant />
          <CareCircleCard />
          <YourReferrals patientId={subjectId} />
          <NavigationRequests patientId={subjectId} />
        </div>
      </div>

      {/* Discretionary / engagement surfaces — real features, deliberately
          lower priority than anything above. */}
      <CareVouchersCard patientId={subjectId} />
      <WellnessPointsSummary patientId={subjectId} />
      <GoalsAndMilestonesCard patientId={subjectId} />
      <TestimonialForm />
    </DashboardSection>
  );
}
