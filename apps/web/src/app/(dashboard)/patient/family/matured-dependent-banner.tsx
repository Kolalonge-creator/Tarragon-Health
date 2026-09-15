"use client";

import { useManagedDependents } from "@/lib/queries/care-access";
import { ClaimAccountCard } from "./claim-account-card";

/**
 * A managed child dependent private.sweep_dependent_majority_review
 * (20260829082711) has flagged as 18+. Renders one card per flagged
 * dependent — usually zero, since most children stay under 18 for years —
 * offering the one action that matters: give them their own login. See
 * claim-dependent-actions.ts for what that actually changes.
 */
export function MaturedDependentBanner() {
  const { data: dependants } = useManagedDependents();
  const matured = (dependants ?? []).filter((d) => d.majority_review_at !== null);

  if (matured.length === 0) return null;

  return (
    <div className="space-y-4">
      {matured.map((dependent) => (
        <ClaimAccountCard
          key={dependent.id}
          dependentId={dependent.id}
          title={`${dependent.full_name ?? "They"} turned 18`}
          description="Give them their own Tarragon login with their real phone number, or keep helping as-is for now. You can do this whenever you're ready."
          invalidateQueryKey={["managed-dependents"]}
        />
      ))}
    </div>
  );
}
