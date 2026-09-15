import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { TherapyApprovalQueue } from "./queue";

export default async function ClinicianTherapyApprovalsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">
          Therapy approvals
        </h1>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          Psychiatry requests from the verified network, waiting on a doctor. Approving needs
          prescribing authority; the rule is enforced in the database, so this page is safe to leave
          visible to the whole team.
        </p>
      </div>
      <TherapyApprovalQueue />
    </div>
  );
}
