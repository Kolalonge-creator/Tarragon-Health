import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { GovernanceDomainsManager } from "./governance-domains-manager";

/**
 * Spec §31.3/§31.18 — who is accountable for each clinical governance
 * domain, answerable by a query rather than only by asking around. Not a
 * governance-board workflow (that's an organisational function, not
 * software); just the roster §31.18's "who is accountable" question keeps
 * asking for.
 */
export default async function GovernanceDomainsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }
  if (!profile.organisation_id) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Clinical governance domains
        </h1>
        <p className="text-charcoal-ink/60">
          Who currently owns each area of clinical governance — patient safety, protocol approval,
          escalation policy, incident review, and the rest of §31.3&apos;s list. A domain shown as
          unassigned genuinely has nobody on file for it, rather than defaulting to a guess.
        </p>
      </div>
      <GovernanceDomainsManager organisationId={profile.organisation_id} />
    </div>
  );
}
