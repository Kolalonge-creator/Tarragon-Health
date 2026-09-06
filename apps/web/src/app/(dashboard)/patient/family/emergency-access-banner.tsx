"use client";

import { useEmergencyGrantsOnMyRecord, useRevokeEmergencyAccess } from "@/lib/queries/emergency-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Shown the moment someone escalates their existing next-of-kin/eldercare access to a 24-hour
 * emergency read grant on this patient's own record — see docs/PATIENT_IDENTITY_MPI_SPEC.md
 * §82.11. A separate in_app notification also fires (private.notify_emergency_access_granted),
 * but this banner is the always-visible, no-need-to-check-notifications version of the same fact.
 */
export function EmergencyAccessBanner() {
  const { data: grants } = useEmergencyGrantsOnMyRecord();
  const revoke = useRevokeEmergencyAccess();

  if (!grants || grants.length === 0) return null;

  return (
    <Card className="border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15">
      <CardContent className="space-y-2 pt-6">
        <p className="font-heading text-sm font-semibold text-charcoal-ink dark:text-night-ink">
          Emergency access is active on your record
        </p>
        {grants.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-charcoal-ink/80 dark:text-night-ink/80">
              <strong>{g.granteeName ?? "Someone you gave care access to"}</strong> can see your
              health information until {shortDateTime(g.expiresAt)}. Reason given:{" "}
              <em>{g.reason}</em>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(g.id)}
            >
              {revoke.isPending ? "Ending…" : "End it now"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
