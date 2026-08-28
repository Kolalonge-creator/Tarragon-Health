import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AbnormalResultDashboard } from "./abnormal-result-dashboard";

/**
 * §7.17 "Abnormal-result dashboard" — Critical/Urgent/High/Routine open-case
 * counts plus Unacknowledged/Overdue, and the underlying worklist with a
 * unified Owner/Status column (§7.9/§7.18) spanning clinician_alerts,
 * escalations, and lab_result_documents. See lib/abnormal-results/
 * case-status.ts for why this is a presentation-layer unification rather
 * than a schema change.
 */
export default async function AbnormalResultDashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    return <p className="text-sm text-charcoal-ink/60">No organisation on file.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Abnormal Results</h1>
        <p className="text-sm text-charcoal-ink/60">
          Every open case, by priority — nothing here should be capable of silently disappearing.
        </p>
      </div>
      <AbnormalResultDashboard organisationId={profile.organisation_id} />
    </div>
  );
}
