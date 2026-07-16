import { redirect } from "next/navigation";
import Link from "next/link";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { hasCoachAccess } from "@/lib/ai-coach/entitlement";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { YourCareTeam } from "@/components/your-care-team";
import { PatientEscalations } from "@/components/patient-escalations";
import { YourReferrals } from "@/components/your-referrals";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { CareTeamContact } from "./care-team-contact";
import { HealthScoreCard } from "@/components/health-score-card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import { getPatientSummaryStats } from "./summary";
import { VitalsForm } from "./vitals-form";
import { VitalsHistory } from "./vitals-history";
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
import { RiskAssessmentDisplay } from "./risk-assessment-display";
import { VaccinationRegistry } from "./vaccination-registry";
import { LogVaccinationForm } from "./log-vaccination-form";
import { VaccinationBooking } from "./vaccination-booking";
import { FacilityDirectory } from "./facility-directory";
import { PatientLocationForm } from "./patient-location-form";
import { EmergencyContactForm } from "./emergency-contact-form";
import { DangerSymptomCheck } from "./danger-symptom-check";
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
  const { data: refillCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "medication_refills",
  });
  const { data: labCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "lab_coordination",
  });

  return (
    <DashboardPlaceholder
      greeting={`Hi${profile.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Patient"
      comingUp={[]}
    >
      <div className="flex justify-end gap-4">
        <Link
          href="/patient/health-passport"
          className="text-sm font-medium text-brand-green hover:underline"
        >
          Health Passport →
        </Link>
        <Link
          href="/patient/subscription"
          className="text-sm font-medium text-brand-green hover:underline"
        >
          Manage your subscription →
        </Link>
      </div>
      <EmergencyAlert
        patientId={profile.id}
        hasEmergencyContact={!!profile.emergency_contact_phone}
      />
      <DangerSymptomCheck patientId={profile.id} />
      <YourCareTeam patientId={profile.id} />
      <PatientLocationForm
        initial={{ state: profile.state, city: profile.city, area: profile.area }}
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
      <HealthScoreCard patientId={profile.id} />
      <RequiresEntitlement
        feature="annual_review"
        fallback={<UpgradePrompt feature="annual_review" />}
      >
        <AnnualReviewCard patientId={profile.id} />
      </RequiresEntitlement>
      <RequiresEntitlement feature="family_dashboard" fallback={null}>
        <FamilyDashboardCard />
      </RequiresEntitlement>
      <PatientEscalations patientId={profile.id} />
      <YourReferrals patientId={profile.id} />
      <RequiresEntitlement
        feature="doctor_checkin"
        fallback={<UpgradePrompt feature="doctor_checkin" />}
      >
        <CareTeamContact />
      </RequiresEntitlement>
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
      <VitalsForm patientId={profile.id} />
      <VitalsHistory patientId={profile.id} />
      <VitalsTrendChart patientId={profile.id} />
      <SymptomLogForm patientId={profile.id} />
      <SymptomLogHistory patientId={profile.id} />
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
      <RequiresEntitlement
        feature="clinician_review"
        fallback={<UpgradePrompt feature="clinician_review" />}
      >
        <CarePlanDisplay patientId={profile.id} />
      </RequiresEntitlement>
      <PreventiveScreeningCalendar
        patientId={profile.id}
        organisationId={profile.organisation_id}
        bookingEnabled={labCoordinationEnabled ?? false}
        patientLocation={{ state: profile.state, city: profile.city, area: profile.area }}
      />
      <RiskAssessmentForm patientId={profile.id} />
      <CareProgrammeRecommendations patientId={profile.id} />
      <RiskAssessmentDisplay patientId={profile.id} />
      <VaccinationRegistry
        patientId={profile.id}
        ageYears={ageFromDateOfBirth(profile.date_of_birth)}
      />
      <VaccinationBooking
        patientId={profile.id}
        patientLocation={{ state: profile.state, city: profile.city, area: profile.area }}
      />
      <LogVaccinationForm patientId={profile.id} />
      <RequiresEntitlement
        feature="lab_coordination"
        fallback={<UpgradePrompt feature="lab_coordination" />}
      >
        <LabCatalogue />
        <LabOrdersList patientId={profile.id} />
        <LabResults patientId={profile.id} />
        {/* FacilityDirectory/BookingRequestsList stay scoped to types with
            no priced catalogue (hospital, radiology, optician,
            vaccination_centre) — lab now books through the catalogue above,
            per the "sole transactional path" decision (see facility-directory.tsx). */}
        <FacilityDirectory patientId={profile.id} />
        <BookingRequestsList patientId={profile.id} />
      </RequiresEntitlement>
      {coachAccess && <AiCoachChat patientId={profile.id} />}
    </DashboardPlaceholder>
  );
}
