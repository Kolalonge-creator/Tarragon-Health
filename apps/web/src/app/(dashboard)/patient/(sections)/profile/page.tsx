import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { Disclosure } from "@/components/ui/disclosure";
import { NAV_ICON } from "@/lib/icons";
import { ConditionLanguageForm } from "@/app/(dashboard)/patient/condition-language-form";
import { EmergencyContactForm } from "@/app/(dashboard)/patient/emergency-contact-form";
import { HeightForm } from "@/app/(dashboard)/patient/height-form";
import { AvatarUploadForm } from "@/app/(dashboard)/patient/avatar-upload-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { ChangePhoneCard } from "@/components/account/change-phone-card";
import { BackupCodesCard } from "@/components/account/backup-codes-card";
import { PasskeysCard } from "@/components/account/passkeys-card";
import { CommunicationPreferencesForm } from "@/app/(dashboard)/patient/communication-preferences-form";
import { GlucoseUnitForm } from "@/app/(dashboard)/patient/glucose-unit-form";
import { MeasurementUnitsForm } from "@/app/(dashboard)/patient/measurement-units-form";
import { CommunicationHistoryCard } from "@/app/(dashboard)/patient/communication-history-card";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutOtherDevicesCard } from "@/components/account/sign-out-other-devices-card";
import { IdentityChangeCard } from "./identity-change-card";

/**
 * One settings group as a collapsible section (design audit P3). "About you" starts open because it holds the emergency contact;
 * the rest start closed so the page is a short list of headings instead of one 6,000px scroll. The old jump list is no longer
 * needed: the headings are the list.
 */
function SettingsGroup({
  id,
  title,
  description,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <Disclosure title={title} hint={description} defaultOpen={defaultOpen}>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">{children}</div>
      </Disclosure>
    </div>
  );
}

export default async function PatientProfilePage() {
  const { profile, measurementUnits, acting } = await getPatientDashboardContext();

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
      <SettingsGroup id="about-you" title="About you" description="Your photo, height and who we call in an emergency." defaultOpen>
        <AvatarUploadForm fullName={profile.full_name ?? "Account"} avatarUrl={profile.avatar_url} />
        <IdentityChangeCard fullName={profile.full_name} dateOfBirth={profile.date_of_birth} acting={!!acting} />
        <HeightForm initial={{ height_cm: profile.height_cm }} />
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
      </SettingsGroup>

      <SettingsGroup id="how-things-show" title="How things are shown" description="Units and wording, so that what you read matches what you are used to.">
        <GlucoseUnitForm initial={profile.glucose_display_unit === "mmol_l" ? "mmol_l" : "mg_dl"} />
        <MeasurementUnitsForm initial={measurementUnits} />
        <ConditionLanguageForm initial={{ condition_language_preference: profile.condition_language_preference }} />
      </SettingsGroup>

      <SettingsGroup id="notifications" title="Notifications" description="How and when we contact you.">
        <CommunicationPreferencesForm
          initial={{
            notification_channel_preference: profile.notification_channel_preference,
            marketing_opt_in: profile.marketing_opt_in,
            preferred_reminder_hour: profile.preferred_reminder_hour,
          }}
        />
      </SettingsGroup>

      <SettingsGroup id="sign-in-security" title="Sign-in & security" description="Password, phone, backup codes, passkeys, two-step sign-in and your other devices.">
        <ChangePasswordForm />
        <ChangePhoneCard />
        <BackupCodesCard />
        <PasskeysCard />
        {/* P21: two-step sign-in is set up on the account page (one place, shared with every role); this is the way there. */}
        <Card>
          <CardHeader>
            <CardTitle>Two-step sign-in</CardTitle>
            <CardDescription>Add a code from an authenticator app each time you sign in, for extra protection.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/account#two-step-sign-in" className="text-sm font-medium text-brand-green underline">
              Set up or manage two-step sign-in
            </Link>
          </CardContent>
        </Card>
        <SignOutOtherDevicesCard confirmFirst />
      </SettingsGroup>

      <Disclosure title="Messages we have sent you" hint="A record of reminders and notices">
        <CommunicationHistoryCard />
      </Disclosure>
    </DashboardSection>
  );
}
