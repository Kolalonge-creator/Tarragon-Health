import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { createClient } from "@/lib/supabase/server";
import { hasCoachAccess } from "@/lib/ai-coach/entitlement";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { CarePlanDisplay } from "@/app/(dashboard)/patient/care-plan-display";
import { PregnancyStatus } from "@/app/(dashboard)/patient/pregnancy-status";
import { ObesitySummary } from "@/app/(dashboard)/patient/obesity-summary";
import { AskADoctor } from "@/app/(dashboard)/patient/ask-a-doctor";
import { BookVideoVisit } from "@/app/(dashboard)/patient/book-video-visit";
import { PatientEscalations } from "@/components/patient-escalations";
import { HospitalAdmissionsCard } from "@/app/(dashboard)/patient/hospital-admissions-card";
import { LifestyleProgressSummary } from "@/app/(dashboard)/patient/lifestyle-progress-summary";
import { YourReferrals } from "@/components/your-referrals";
import { AiCoachChat } from "@/app/(dashboard)/patient/ai-coach-chat";
import { CareCircleCard } from "@/app/(dashboard)/patient/care-circle-card";
import { CareVouchersCard } from "@/components/care-vouchers-card";
import { WellnessPointsSummary } from "@/app/(dashboard)/patient/wellness-points-summary";
import { TestimonialForm } from "@/components/testimonial-form";

export default async function PatientCarePage() {
  const { profile, subjectId } = await getPatientDashboardContext();
  const supabase = await createClient();
  const coachAccess = await hasCoachAccess(supabase);

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
            <CarePlanDisplay patientId={subjectId} />
            <ObesitySummary
              patientId={subjectId}
              conditionLanguagePreference={profile.condition_language_preference}
            />
          </RequiresEntitlement>
          {/* Not entitlement-gated: the obstetric-led guard (§20.2) needs to
              fire for anyone on a diabetes care plan regardless of tier, and
              self-reporting pregnancy shouldn't require a paid plan. Renders a
              plain status card for everyone else. */}
          <PregnancyStatus patientId={subjectId} />
          <PatientEscalations patientId={subjectId} />
          <HospitalAdmissionsCard patientId={subjectId} />
          <RequiresEntitlement feature="lifestyle_coaching" fallback={<UpgradePrompt feature="lifestyle_coaching" />}>
            <LifestyleProgressSummary patientId={subjectId} />
          </RequiresEntitlement>
        </div>

        <div className="space-y-4">
          {/* Paid per-visit service — no plan gate; the card itself carries the
              availability + not-for-emergencies copy. */}
          <BookVideoVisit patientId={subjectId} />
          <RequiresEntitlement feature="async_doctor_visit" fallback={<UpgradePrompt feature="async_doctor_visit" />}>
            <AskADoctor patientId={subjectId} organisationId={profile.organisation_id} />
          </RequiresEntitlement>
          {coachAccess && <AiCoachChat patientId={subjectId} />}
          <CareCircleCard />
          <YourReferrals patientId={subjectId} />
        </div>
      </div>

      {/* Discretionary / engagement surfaces — real features, deliberately
          lower priority than anything above. */}
      <CareVouchersCard patientId={subjectId} />
      <WellnessPointsSummary patientId={subjectId} />
      <TestimonialForm />
    </DashboardSection>
  );
}
