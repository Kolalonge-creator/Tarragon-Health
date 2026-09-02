import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { NAV_ICON } from "@/lib/icons";
import { IdentityVerificationCard } from "@/app/onboarding/identity-verification-card";
import { ConditionLanguageForm } from "@/app/(dashboard)/patient/condition-language-form";
import { EmergencyContactForm } from "@/app/(dashboard)/patient/emergency-contact-form";
import { AvatarUploadForm } from "@/app/(dashboard)/patient/avatar-upload-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { CommunicationPreferencesForm } from "@/app/(dashboard)/patient/communication-preferences-form";
import { CommunicationHistoryCard } from "@/app/(dashboard)/patient/communication-history-card";
import { FeatureAnchor } from "@/components/patient/feature-anchor";

export default async function PatientProfilePage() {
  const { profile, subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="profile"
      title="Profile & settings"
      description="Keep your emergency contacts and care preferences up to date."
      icon={NAV_ICON.settings}
    >
      {profile.patient_number && (
        <p className="text-sm text-charcoal-ink/60">
          Your patient ID: <span className="font-mono font-medium text-charcoal-ink">{profile.patient_number}</span>
        </p>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <FeatureAnchor id="details">
            <AvatarUploadForm
              fullName={profile.full_name ?? "Account"}
              avatarUrl={profile.avatar_url}
            />
          </FeatureAnchor>
          {/* Identity verification lives here rather than in onboarding: it is
              optional and non-blocking, and asking a first-time visitor for a
              government ID before they have done anything is the single most
              off-putting step in the signup path. Location moved to the
              shared /account page (see account/page.tsx) so it isn't edited
              in two places. */}
          <FeatureAnchor id="identity">
            <IdentityVerificationCard patientId={subjectId} />
          </FeatureAnchor>
          <FeatureAnchor id="emergency-contact">
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
          </FeatureAnchor>
        </div>

        <div className="space-y-4">
          <FeatureAnchor id="condition-language">
            <ConditionLanguageForm
              initial={{ condition_language_preference: profile.condition_language_preference }}
            />
          </FeatureAnchor>
          <FeatureAnchor id="communication-preferences">
            <CommunicationPreferencesForm
              initial={{
                notification_channel_preference: profile.notification_channel_preference,
                marketing_opt_in: profile.marketing_opt_in,
              }}
            />
          </FeatureAnchor>
          <FeatureAnchor id="password">
            <ChangePasswordForm />
          </FeatureAnchor>
        </div>
      </div>
      <FeatureAnchor id="communication-history">
        <CommunicationHistoryCard />
      </FeatureAnchor>
    </DashboardSection>
  );
}
