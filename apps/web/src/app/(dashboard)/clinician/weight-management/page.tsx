import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { WeightManagementQueue } from "./queue";

export default async function ClinicianWeightManagementPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">
          Weight management
        </h1>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          Patients you are supervising on weight-loss medication they obtained themselves. Tarragon
          does not prescribe or supply it; what is being supervised is how it is used.
        </p>
      </div>
      <WeightManagementQueue />
    </div>
  );
}
