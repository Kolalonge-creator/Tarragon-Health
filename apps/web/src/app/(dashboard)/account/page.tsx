import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { ROLE_DISPLAY_LABEL } from "@/lib/auth/roles";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { MfaSettingsCard } from "@/components/account/mfa-settings-card";
import { SignOutOtherDevicesCard } from "@/components/account/sign-out-other-devices-card";
import { PatientLocationForm } from "@/app/(dashboard)/patient/patient-location-form";
import { JoinEmployerCodeForm } from "./join-employer-code-form";

// The seeded default consumer org (20260706084837) every self-serve signup
// lands on until claimed by a real employer/HMO/clinic roster — the same
// literal public.employer_join_with_code checks server-side.
const DEFAULT_CONSUMER_ORG_ID = "00000000-0000-0000-0000-000000000001";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/40">{label}</dt>
      <dd className="mt-0.5 text-sm text-charcoal-ink">{value}</dd>
    </div>
  );
}

/**
 * Shared, role-agnostic account page — the "Profile & settings" destination
 * behind the top-right profile menu for every role. A patient's location
 * lives here (shared with onboarding's PatientLocationForm, not a second
 * copy); their emergency contact, next of kin, and result-language
 * preference stay on the fuller /patient/profile section instead.
 * Deliberately read-only for identity fields: clinical_staff is
 * admin-managed (CLAUDE.md's Clinical Tier Ladder rules), and a phone-number
 * change needs its own re-verification flow this page doesn't attempt.
 */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const isStaffTier = profile.role === "clinician" || profile.role === "care_coordinator";
  const staff = isStaffTier ? await getCurrentClinicalStaff() : null;

  const supporterOnly = profile.receives_care === false;
  const roleLabel = supporterOnly ? "Supporter" : (ROLE_DISPLAY_LABEL[profile.role] ?? profile.role);
  // A supporter-only login is profiles.role === 'patient' with receives_care
  // false (see dashboard/layout.tsx's identical isPatient derivation) — they
  // fund somebody else's care and have none of their own, so they get neither
  // a Patient ID nor the location form below.
  const isPatient = profile.role === "patient" && !supporterOnly;
  // clinician/care_coordinator carry their EMP- number on clinical_staff
  // (tied to their clinical record); every other staff role carries it
  // directly on profiles instead (see 20260806115556_profiles_staff_number.sql
  // — those roles have no clinical_staff row to hang it off).
  const staffNumber = staff?.staff_number ?? profile.staff_number;
  const idLabel = isPatient ? "Patient ID" : staffNumber ? "Staff ID" : undefined;
  const idValue = isPatient ? profile.patient_number : staffNumber;

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verifiedFactorId =
    factors?.totp.find((f) => f.status === "verified")?.id ?? null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Profile &amp; settings</h1>
        <p className="text-charcoal-ink/60">Your account details and sign-in settings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Your details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" value={profile.full_name} />
            <Field
              label="Role"
              value={<Badge variant="grey">{roleLabel}</Badge>}
            />
            <Field label="Email" value={user.email} />
            <Field label="Phone" value={profile.phone} />
            {idLabel && idValue && (
              <Field label={idLabel} value={<span className="font-mono">{idValue}</span>} />
            )}
          </dl>
        </CardContent>
      </Card>

      {isStaffTier && staff && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Clinical record</CardTitle>
            <CardDescription>
              Set and verified by your organisation&apos;s admin; contact them to update any of
              this.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Tier"
                value={staff.doctor_tier ? DOCTOR_TIER_LABEL[staff.doctor_tier] : "Not yet assigned"}
              />
              {staff.is_clinical_director && (
                <Field label="Clinical governance" value={<Badge variant="blue">Clinical Director</Badge>} />
              )}
              <Field label="Specialty" value={staff.specialty} />
              <Field
                label="Credential"
                value={
                  staff.credential_type && staff.credential_number
                    ? `${staff.credential_type} ${staff.credential_number}`
                    : undefined
                }
              />
            </dl>
          </CardContent>
        </Card>
      )}

      {isPatient && (
        <div className="space-y-2">
          <PatientLocationForm
            initial={{ state: profile.state, city: profile.city, area: profile.area }}
          />
          <p className="text-xs text-charcoal-ink/50">
            Emergency contact, next of kin, and how we explain results to you stay on your
            dashboard&apos;s Profile section.
          </p>
        </div>
      )}

      {isPatient && profile.organisation_id === DEFAULT_CONSUMER_ORG_ID && <JoinEmployerCodeForm />}

      <ChangePasswordForm />
      <MfaSettingsCard verifiedFactorId={verifiedFactorId} />
      <SignOutOtherDevicesCard />
    </div>
  );
}
