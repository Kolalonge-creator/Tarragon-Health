import { redirect } from "next/navigation";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { VitalsForm } from "./vitals-form";
import { VitalsHistory } from "./vitals-history";
import { MedicationsList } from "./medications-list";
import { TodaysDoses } from "./todays-doses";
import { AddMedicationForm } from "./add-medication-form";
import { CarePlanDisplay } from "./care-plan-display";
import { PreventiveScreeningCalendar } from "./preventive-screening-calendar";
import { RiskAssessmentForm } from "./risk-assessment-form";
import { RiskAssessmentDisplay } from "./risk-assessment-display";
import { VaccinationRegistry } from "./vaccination-registry";
import { LogVaccinationForm } from "./log-vaccination-form";

export default async function PatientPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  return (
    <DashboardPlaceholder
      greeting={`Hi${profile.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Patient"
      comingUp={["Health Passport download"]}
    >
      <VitalsForm patientId={profile.id} />
      <VitalsHistory patientId={profile.id} />
      <TodaysDoses patientId={profile.id} />
      <MedicationsList patientId={profile.id} />
      <AddMedicationForm patientId={profile.id} source="patient" />
      <CarePlanDisplay patientId={profile.id} />
      <PreventiveScreeningCalendar patientId={profile.id} />
      <RiskAssessmentForm patientId={profile.id} />
      <RiskAssessmentDisplay patientId={profile.id} />
      <VaccinationRegistry
        patientId={profile.id}
        ageYears={ageFromDateOfBirth(profile.date_of_birth)}
      />
      <LogVaccinationForm patientId={profile.id} />
    </DashboardPlaceholder>
  );
}
