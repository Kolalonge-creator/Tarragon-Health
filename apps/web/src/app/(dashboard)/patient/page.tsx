import { redirect } from "next/navigation";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { hasCoachAccess } from "@/lib/ai-coach/entitlement";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { YourCareTeam } from "@/components/your-care-team";
import { PatientEscalations } from "@/components/patient-escalations";
import { YourReferrals } from "@/components/your-referrals";
import { PatientTimeline } from "@/components/patient-timeline";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { CareTeamContact } from "./care-team-contact";
import { HealthScoreCard } from "@/components/health-score-card";
import { StatTile } from "@/components/ui/stat-tile";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SectionNav } from "@/components/shell/section-nav";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { getPatientSummaryStats, getPatientPreventionStats } from "./summary";
import Link from "next/link";
import { AnnualHealthCheckBooking } from "./annual-health-check-booking";
import { ResultsTrendsCard } from "./results-trends-card";
import { VitalsForm } from "./vitals-form";
import { VitalsHistory } from "./vitals-history";
import { HbpmSummaryCard } from "./hbpm-summary-card";
import { SymptomLogForm } from "./symptom-log-form";
import { SymptomLogHistory } from "./symptom-log-history";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { MedicationsList } from "./medications-list";
import { LabMonitoringCard } from "./lab-monitoring-card";
import { AdherenceCheckins } from "./adherence-checkins";
import { TodaysDoses } from "./todays-doses";
import { AddMedicationForm } from "./add-medication-form";
import { CarePlanDisplay } from "./care-plan-display";
import { PreventiveScreeningCalendar } from "./preventive-screening-calendar";
import { RiskAssessmentForm } from "./risk-assessment-form";
import { CareProgrammeRecommendations } from "./care-programme-recommendations";
import { PreventiveProgrammes } from "./preventive-programmes";
import { ReproductiveHealthCard } from "./reproductive-health-card";
import { HealthEducation } from "./health-education";
import { RiskAssessmentDisplay } from "./risk-assessment-display";
import { VaccinationForFamily } from "./vaccination-for-family";
import { FacilityDirectory } from "./facility-directory";
import { PatientLocationForm } from "./patient-location-form";
import { ReminderPreferenceForm } from "./reminder-preference-form";
import { WearableConnectSection } from "./wearable-connect-section";
import { EmergencyContactForm } from "./emergency-contact-form";
import { DangerSymptomCheck } from "./danger-symptom-check";
import { HospitalAdmissionsCard } from "./hospital-admissions-card";
import { EmergencyAlert } from "./emergency-alert";
import { LabCatalogue } from "./lab-catalogue";
import { LabOrdersList } from "./lab-orders-list";
import { LabResults } from "./lab-results";
import { PharmacyCatalogue } from "./pharmacy-catalogue";
import { PharmacyOrdersList } from "./pharmacy-orders-list";
import { BookingRequestsList } from "./booking-requests-list";
import { AiCoachChat } from "./ai-coach-chat";
import { FamilyDashboardCard } from "./family-dashboard-card";
import { AnnualReviewCard } from "./annual-review-card";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "vitals", label: "Vitals & symptoms" },
  { id: "medications", label: "Medications" },
  { id: "prevention", label: "Prevention" },
  { id: "labs", label: "Labs & bookings" },
  { id: "care", label: "Care & support" },
  { id: "profile", label: "Profile" },
];

export default async function PatientPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  const supabase = await createClient();
  const coachAccess = await hasCoachAccess(supabase);
  const stats = await getPatientSummaryStats(profile.id);
  const prevention = await getPatientPreventionStats(profile.id);
  const { data: refillCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "medication_refills",
  });
  const { data: labCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "lab_coordination",
  });
  // prevention_coordination is the Prevent-tier / prevention-screening-add-on
  // key: booking rights on the screening calendar and the labs surfaces,
  // without the chronic plans' full lab_coordination promise.
  const { data: preventionCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "prevention_coordination",
  });
  const screeningBookingEnabled =
    (labCoordinationEnabled ?? false) || (preventionCoordinationEnabled ?? false);

  return (
    <DashboardPlaceholder
      greeting={`Hi${profile.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Patient"
      comingUp={[]}
    >
      {/* Safety surfaces stay above everything, outside any section. */}
      <EmergencyAlert
        patientId={profile.id}
        hasEmergencyContact={!!profile.emergency_contact_phone}
      />
      <DangerSymptomCheck patientId={profile.id} />

      <SectionNav items={SECTIONS} />

      <DashboardSection
        id="overview"
        title="Overview"
        description={
          prevention.hasActiveCarePlan
            ? "Today at a glance — your numbers, your care team, and recent activity."
            : "Staying well at a glance — your prevention plan, your care team, and recent activity."
        }
        icon={NAV_ICON.dashboard}
      >
        {/* Dual-state overview: a patient in a chronic programme leads with
            monitoring numbers; a healthy patient leads with prevention. Both
            states read the same shared record — nothing is hidden, only led
            with differently. */}
        {prevention.hasActiveCarePlan ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile
              icon={SEMANTIC_ICON.bp}
              label="Latest BP"
              value={stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : "—"}
              unit="mmHg"
            />
            <StatTile
              icon={SEMANTIC_ICON.diabetes}
              label="Latest glucose"
              value={stats.latestGlucoseMmolL !== null ? String(stats.latestGlucoseMmolL) : "—"}
              unit="mmol/L"
            />
            <StatTile
              icon={SEMANTIC_ICON.medication}
              label="Active meds"
              value={String(stats.activeMedicationCount)}
            />
            <StatTile
              icon={SEMANTIC_ICON.preventive}
              label="Doses today"
              value={`${stats.dosesTaken}/${stats.dosesTotal}`}
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatTile
                icon={SEMANTIC_ICON.preventive}
                label="Screenings due"
                value={
                  prevention.hasRiskAssessment ? String(prevention.screeningsDueCount) : "—"
                }
              />
              <StatTile
                icon={SEMANTIC_ICON.labs}
                label="Next screening"
                value={
                  prevention.nextScreening
                    ? new Date(prevention.nextScreening.dueDate).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })
                    : "—"
                }
              />
              <StatTile
                icon={NAV_ICON.vaccination}
                label="Vaccines due"
                value={
                  prevention.hasRiskAssessment ? String(prevention.vaccinationsDueCount) : "—"
                }
              />
              <StatTile
                icon={SEMANTIC_ICON.bp}
                label="Latest BP"
                value={
                  stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : "—"
                }
                unit="mmHg"
              />
            </div>
            {!prevention.hasRiskAssessment && (
              <p className="text-sm text-charcoal-ink/70">
                Two minutes on your{" "}
                <Link href="/patient/prevention" className="text-brand-green hover:underline">
                  health profile
                </Link>{" "}
                builds your personal screening and vaccination calendar — the checks that keep
                healthy people healthy.
              </p>
            )}
          </>
        )}
        <HealthScoreCard patientId={profile.id} />
        <YourCareTeam patientId={profile.id} />
        <PatientTimeline patientId={profile.id} />
      </DashboardSection>

      <DashboardSection
        id="vitals"
        title="Vitals & symptoms"
        description="Log readings and symptoms, and see how they trend over time."
        icon={SEMANTIC_ICON.bp}
      >
        <VitalsForm patientId={profile.id} />
        <HbpmSummaryCard patientId={profile.id} />
        <VitalsHistory patientId={profile.id} />
        <VitalsTrendChart patientId={profile.id} />
        <SymptomLogForm patientId={profile.id} />
        <SymptomLogHistory patientId={profile.id} />
        <WearableConnectSection patientId={profile.id} />
      </DashboardSection>

      <DashboardSection
        id="medications"
        title="Medications & pharmacy"
        description="Today's doses, your medicines cabinet, and pharmacy orders."
        icon={SEMANTIC_ICON.medication}
      >
        <TodaysDoses patientId={profile.id} />
        <MedicationsList
          patientId={profile.id}
          refillCoordinationEnabled={refillCoordinationEnabled ?? false}
          canStop
        />
        <AdherenceCheckins patientId={profile.id} />
        <LabMonitoringCard patientId={profile.id} />
        <AddMedicationForm patientId={profile.id} source="patient" />
        <RequiresEntitlement
          feature="medication_refills"
          fallback={<UpgradePrompt feature="medication_refills" />}
        >
          {profile.organisation_id && (
            <PharmacyCatalogue
              organisationId={profile.organisation_id}
              patientId={profile.id}
              patientLocation={{ state: profile.state, city: profile.city, area: profile.area }}
            />
          )}
          <PharmacyOrdersList patientId={profile.id} />
        </RequiresEntitlement>
      </DashboardSection>

      <DashboardSection
        id="prevention"
        title="Prevention & screening"
        description="Screenings, risk checks, vaccinations, and learning picked for you."
        icon={SEMANTIC_ICON.preventive}
      >
        <p className="text-sm text-charcoal-ink/70">
          Everything prevention in one place:{" "}
          <Link href="/patient/prevention" className="text-brand-green hover:underline">
            open your prevention hub
          </Link>{" "}
          or start{" "}
          <Link href="/patient/health-check" className="text-brand-green hover:underline">
            this year&apos;s Health Check
          </Link>
          .
        </p>
        <AnnualHealthCheckBooking
          patientId={profile.id}
          organisationId={profile.organisation_id}
          patientLocation={{ state: profile.state, city: profile.city, area: profile.area }}
          sex={profile.sex}
        />
        <PreventiveScreeningCalendar
          patientId={profile.id}
          organisationId={profile.organisation_id}
          bookingEnabled={screeningBookingEnabled}
          patientLocation={{ state: profile.state, city: profile.city, area: profile.area }}
        />
        <RiskAssessmentForm patientId={profile.id} />
        <CareProgrammeRecommendations patientId={profile.id} />
        <PreventiveProgrammes
          patientId={profile.id}
          ageYears={ageFromDateOfBirth(profile.date_of_birth)}
          sex={profile.sex}
        />
        {profile.sex === "female" && profile.organisation_id && (
          <ReproductiveHealthCard
            patientId={profile.id}
            organisationId={profile.organisation_id}
          />
        )}
        <RiskAssessmentDisplay patientId={profile.id} />
        <VaccinationForFamily
          self={{
            id: profile.id,
            label: "Me",
            ageYears: ageFromDateOfBirth(profile.date_of_birth),
            dateOfBirth: profile.date_of_birth,
            sex: profile.sex,
          }}
          patientLocation={{ state: profile.state, city: profile.city, area: profile.area }}
        />
        {/* Annual Doctor Review lives with prevention (it's the yearly
            whole-body review), not buried under Care — the gate is unchanged. */}
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
            <HealthEducation
              patientId={profile.id}
              organisationId={profile.organisation_id}
            />
          </RequiresEntitlement>
        )}
      </DashboardSection>

      <DashboardSection
        id="labs"
        title="Labs & bookings"
        description="Book lab tests, track orders and results, and find facilities near you."
        icon={SEMANTIC_ICON.labs}
      >
        {/* lab_coordination (chronic plans) OR prevention_coordination
            (Prevent tier / prevention-screening add-on) both open this
            section — a Prevent subscriber who books screenings needs to see
            and pay for their own orders. Plain conditional rather than
            RequiresEntitlement because the gate is an OR of two keys. */}
        {screeningBookingEnabled ? (
          <>
            <LabCatalogue />
            <LabOrdersList patientId={profile.id} />
            <ResultsTrendsCard patientId={profile.id} />
            <LabResults patientId={profile.id} />
            {/* FacilityDirectory/BookingRequestsList stay scoped to types with
                no priced catalogue (hospital, radiology, optician,
                vaccination_centre) — lab now books through the catalogue above,
                per the "sole transactional path" decision (see facility-directory.tsx). */}
            <FacilityDirectory patientId={profile.id} />
            <BookingRequestsList patientId={profile.id} />
          </>
        ) : (
          <>
            <UpgradePrompt feature="lab_coordination" />
            {/* A Free user can still have real orders to pay/track — the
                Annual Health Check is purchasable on any plan — so the order
                list, trends, and results stay visible below the prompt. */}
            <LabOrdersList patientId={profile.id} />
            <ResultsTrendsCard patientId={profile.id} />
            <LabResults patientId={profile.id} />
          </>
        )}
      </DashboardSection>

      <DashboardSection
        id="care"
        title="Care & support"
        description="Your care plan, reviews, referrals, and ways to reach your care team."
        icon={SEMANTIC_ICON.clinicianFollowUp}
      >
        <RequiresEntitlement
          feature="clinician_review"
          fallback={<UpgradePrompt feature="clinician_review" />}
        >
          <CarePlanDisplay patientId={profile.id} />
        </RequiresEntitlement>
        <PatientEscalations patientId={profile.id} />
        <HospitalAdmissionsCard patientId={profile.id} />
        <YourReferrals patientId={profile.id} />
        <RequiresEntitlement
          feature="doctor_checkin"
          fallback={<UpgradePrompt feature="doctor_checkin" />}
        >
          <CareTeamContact />
        </RequiresEntitlement>
        <RequiresEntitlement feature="family_dashboard" fallback={null}>
          <FamilyDashboardCard />
        </RequiresEntitlement>
        {coachAccess && <AiCoachChat patientId={profile.id} />}
      </DashboardSection>

      <DashboardSection
        id="profile"
        title="Profile & settings"
        description="Keep your location and emergency contacts up to date."
        icon={NAV_ICON.settings}
      >
        <PatientLocationForm
          initial={{ state: profile.state, city: profile.city, area: profile.area }}
        />
        <ReminderPreferenceForm
          initial={{ preferred_reminder_channel: profile.preferred_reminder_channel }}
        />
        <EmergencyContactForm
          initial={{
            emergency_contact_name: profile.emergency_contact_name,
            emergency_contact_phone: profile.emergency_contact_phone,
            emergency_contact_relationship: profile.emergency_contact_relationship,
            emergency_contact_consent: profile.emergency_contact_consent,
            next_of_kin_name: profile.next_of_kin_name,
            next_of_kin_phone: profile.next_of_kin_phone,
          }}
        />
      </DashboardSection>
    </DashboardPlaceholder>
  );
}
