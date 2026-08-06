import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { ROLE_DISPLAY_LABEL } from "@/lib/auth/roles";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChangePasswordForm } from "@/components/account/change-password-form";

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
 * behind the top-right profile menu for every account except a plain patient
 * (who keeps the fuller, editable section on their own dashboard at
 * /patient/profile; this page still links out to it below for that role).
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
  // clinician/care_coordinator carry their EMP- number on clinical_staff
  // (tied to their clinical record); every other staff role carries it
  // directly on profiles instead (see 20260806115556_profiles_staff_number.sql
  // — those roles have no clinical_staff row to hang it off).
  const staffNumber = staff?.staff_number ?? profile.staff_number;
  const idLabel = profile.role === "patient" ? "Patient ID" : staffNumber ? "Staff ID" : undefined;
  const idValue = profile.role === "patient" ? profile.patient_number : staffNumber;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Profile &amp; settings</h1>
        <p className="text-charcoal-ink/60">Your account details and sign-in settings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
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
            <CardTitle>Clinical record</CardTitle>
            <CardDescription>
              Set and verified by your organisation&apos;s admin — contact them to update any of
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

      {profile.role === "patient" && (
        <Card variant="soft">
          <CardHeader>
            <CardTitle>Location, emergency contact &amp; more</CardTitle>
            <CardDescription>
              Manage your state/area, emergency contact, next of kin and how we explain results to
              you from your dashboard&apos;s Profile section.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/patient/profile" className="text-sm font-medium text-brand-green hover:underline">
              Go to your Profile &amp; settings section →
            </Link>
          </CardContent>
        </Card>
      )}

      <ChangePasswordForm />
    </div>
  );
}
