import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { InsuranceOverview } from "./insurance-overview";

export default async function PatientInsurancePage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "patient") {
    redirect("/");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }
  if (!profile.organisation_id) {
    return null;
  }
  const organisationId = profile.organisation_id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Your insurance</h1>
        <p className="text-charcoal-ink/60">
          The policy on file for you, what it covers, and the status of any pre-authorisation
          requests or claims your care team has submitted on your behalf.
        </p>
      </div>
      <InsuranceOverview patientId={profile.id} organisationId={organisationId} />
    </div>
  );
}
