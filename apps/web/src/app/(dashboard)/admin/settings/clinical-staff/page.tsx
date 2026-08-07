import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ClinicalStaffManager } from "./clinical-staff-manager";

export default async function ClinicalStaffSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defense-in-depth check on top of that,
  // since this page's content (not just its RLS-protected data) is
  // admin-only.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Clinical staff
        </h1>
        <p className="text-charcoal-ink/60">
          The single source of truth for every named Clinical Director, care team doctor, and
          escalation doctor shown anywhere in the product: docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4/§5. A
          record starts inactive and unverified: verify the MDCN/NMCN credential before
          activating it, since an unverified record can never be marked active. License
          verification is annual; re-verify before the due date shown on each record. Clinical
          Directors and Escalation Doctors also need current indemnity/malpractice cover on file
          before they can be activated, unless an admin has explicitly exempted that person, their
          role, or the whole organisation from the requirement.
        </p>
        <p className="mt-2 text-charcoal-ink/60">
          Verifying the license and verifying the registration number are two different acts.
          Marking a license verified clears someone to work here, and applies to non-clinical staff
          who have no registration number at all. Verifying the registration number means an
          administrator looked that specific number up on the register, and it is the only thing
          that lets a doctor put their registration on a Health Passport an employer, a clinic or
          an embassy will check. Neither can be done to your own record.
        </p>
      </div>
      <ClinicalStaffManager currentProfileId={profile.id} />
    </div>
  );
}
