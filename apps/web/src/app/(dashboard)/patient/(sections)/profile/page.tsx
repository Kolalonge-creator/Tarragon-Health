import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { NAV_ICON } from "@/lib/icons";
import { IdentityVerificationCard } from "@/app/onboarding/identity-verification-card";
import { PatientLocationForm } from "@/app/(dashboard)/patient/patient-location-form";
import { ConditionLanguageForm } from "@/app/(dashboard)/patient/condition-language-form";
import { EmergencyContactForm } from "@/app/(dashboard)/patient/emergency-contact-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { AiUsageDisclosure } from "@/app/(dashboard)/patient/ai-usage-disclosure";

export default async function PatientProfilePage() {
  const { profile, subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="profile"
      title="Profile & settings"
      description="Keep your location and emergency contacts up to date."
      icon={NAV_ICON.settings}
    >
      {profile.patient_number && (
        <p className="text-sm text-charcoal-ink/60">
          Your patient ID: <span className="font-mono font-medium text-charcoal-ink">{profile.patient_number}</span>
        </p>
      )}
      {/* Identity verification lives here rather than in onboarding: it is
          optional and non-blocking, and asking a first-time visitor for a
          government ID before they have done anything is the single most
          off-putting step in the signup path. */}
      <IdentityVerificationCard patientId={subjectId} />
      <PatientLocationForm
        initial={{ state: profile.state, city: profile.city, area: profile.area }}
      />
      <ConditionLanguageForm
        initial={{ condition_language_preference: profile.condition_language_preference }}
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
      <ChangePasswordForm />
      <AiUsageDisclosure />
    </DashboardSection>
  );
}
