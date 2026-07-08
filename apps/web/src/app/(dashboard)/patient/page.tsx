import { redirect } from "next/navigation";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { hasCoachAccess } from "@/lib/ai-coach/entitlement";
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
import { FacilityDirectory } from "./facility-directory";
import { BookingRequestsList } from "./booking-requests-list";
import { AiCoachChat } from "./ai-coach-chat";

export default async function PatientPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const supabase = await createClient();
  const coachAccess = await hasCoachAccess(supabase);

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
      <FacilityDirectory patientId={profile.id} />
      <BookingRequestsList patientId={profile.id} />
      {coachAccess && <AiCoachChat patientId={profile.id} />}
    </DashboardPlaceholder>
  );
}
