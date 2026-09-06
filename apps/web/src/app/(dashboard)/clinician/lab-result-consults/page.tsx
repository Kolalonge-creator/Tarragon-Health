import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { LabResultConsultQueue } from "./lab-result-consult-queue";

export default async function ClinicianLabResultConsultsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Lab-result consults
        </h1>
        <p className="text-sm text-charcoal-ink/60">
          Patients who paid the self-arranged lab-result consultation fee, waiting for a time.
        </p>
      </div>
      <LabResultConsultQueue />
    </div>
  );
}
