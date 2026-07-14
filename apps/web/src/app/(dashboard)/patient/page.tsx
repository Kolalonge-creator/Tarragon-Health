import { redirect } from "next/navigation";
import Link from "next/link";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { hasCoachAccess } from "@/lib/ai-coach/entitlement";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { YourCareTeam } from "@/components/your-care-team";
import { PatientEscalations } from "@/components/patient-escalations";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { CareTeamContact } from "./care-team-contact";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import { getPatientSummaryStats } from "./summary";
import { VitalsForm } from "./vitals-form";
import { VitalsHistory } from "./vitals-history";
import { SymptomLogForm } from "./symptom-log-form";
import { SymptomLogHistory } from "./symptom-log-history";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { MedicationsList } from "./medications-list";
import { TodaysDoses } from "./todays-doses";
import { AddMedicationForm } from "./add-medication-form";
import { CarePlanDisplay } from "./care-plan-display";
import { PreventiveScreeningCalendar } from "./preventive-screening-calendar";
import { RiskAssessmentForm } from "./risk-assessment-form";
import { RiskAssessmentDisplay } from "./risk-assessment-display";
import { VaccinationRegistry } from "./vaccination-registry";
import { LogVaccinationForm } from "./log-vaccination-form";
import { FacilityDirectory } from "./facility-directory";
import { BookingRequestsList } from "./booking-requests-list";
import { AiCoachChat } from "./ai-coach-chat";
import { FamilyDashboardCard } from "./family-dashboard-card";

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

  return (
    <DashboardPlaceholder
      greeting={`Hi${profile.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Patient"
      comingUp={["Health Passport download"]}
    >
      <div className="flex justify-end">
        <Link
          href="/patient/subscription"
          className="text-sm font-medium text-brand-green hover:underline"
        >
          Manage your subscription →
        </Link>
      </div>
      <YourCareTeam patientId={profile.id} />
      <RequiresEntitlement feature="family_dashboard" fallback={null}>
        <FamilyDashboardCard />
      </RequiresEntitlement>
      <PatientEscalations patientId={profile.id} />
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
      />
      <AddMedicationForm patientId={profile.id} source="patient" />
      <RequiresEntitlement
        feature="clinician_review"
        fallback={<UpgradePrompt feature="clinician_review" />}
      >
        <CarePlanDisplay patientId={profile.id} />
      </RequiresEntitlement>
      <PreventiveScreeningCalendar patientId={profile.id} />
      <RiskAssessmentForm patientId={profile.id} />
      <RiskAssessmentDisplay patientId={profile.id} />
      <VaccinationRegistry
        patientId={profile.id}
        ageYears={ageFromDateOfBirth(profile.date_of_birth)}
      />
      <LogVaccinationForm patientId={profile.id} />
      <RequiresEntitlement
        feature="lab_coordination"
        fallback={<UpgradePrompt feature="lab_coordination" />}
      >
        {/* Single directory/booking surface backs both pricing.ts's "lab
            test coordination" and "medication refill coordination" — labs,
            pharmacies, hospitals, etc. all book through the same facility
            directory, and both features are always granted together on
            every current paid plan (see seed.sql). */}
        <FacilityDirectory patientId={profile.id} />
        <BookingRequestsList patientId={profile.id} />
      </RequiresEntitlement>
      {coachAccess && <AiCoachChat patientId={profile.id} />}
    </DashboardPlaceholder>
  );
}
