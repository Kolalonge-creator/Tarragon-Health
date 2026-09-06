import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
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
      <PageHeader
        title="Your insurance"
        icon={NAV_ICON.insurance}
        description="The policy on file for you, what it covers, and the status of any pre-authorisation requests or claims your care team has submitted on your behalf."
      />
      <InsuranceOverview patientId={profile.id} organisationId={organisationId} />
    </div>
  );
}
