import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { NAV_ICON } from "@/lib/icons";
import { ConditionLanguageForm } from "@/app/(dashboard)/patient/condition-language-form";
import { EmergencyContactForm } from "@/app/(dashboard)/patient/emergency-contact-form";
import { HeightForm } from "@/app/(dashboard)/patient/height-form";
import { AvatarUploadForm } from "@/app/(dashboard)/patient/avatar-upload-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { CommunicationPreferencesForm } from "@/app/(dashboard)/patient/communication-preferences-form";
import { GlucoseUnitForm } from "@/app/(dashboard)/patient/glucose-unit-form";
import { CommunicationHistoryCard } from "@/app/(dashboard)/patient/communication-history-card";

export default async function PatientProfilePage() {
  const { profile } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="profile"
      title="Profile & settings"
      description="Keep your emergency contacts and care preferences up to date."
      icon={NAV_ICON.settings}
    >
      {profile.patient_number && (
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          Your patient ID: <span className="font-mono font-medium text-charcoal-ink dark:text-night-ink">{profile.patient_number}</span>
        </p>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <AvatarUploadForm
            fullName={profile.full_name ?? "Account"}
            avatarUrl={profile.avatar_url}
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
        </div>

        <div className="space-y-4">
          <HeightForm initial={{ height_cm: profile.height_cm }} />
          <ConditionLanguageForm
            initial={{ condition_language_preference: profile.condition_language_preference }}
          />
          <GlucoseUnitForm
            initial={profile.glucose_display_unit === "mmol_l" ? "mmol_l" : "mg_dl"}
          />
          <CommunicationPreferencesForm
            initial={{
              notification_channel_preference: profile.notification_channel_preference,
              marketing_opt_in: profile.marketing_opt_in,
              preferred_reminder_hour: profile.preferred_reminder_hour,
            }}
          />
          <ChangePasswordForm />
        </div>
      </div>
      <CommunicationHistoryCard />
    </DashboardSection>
  );
}
