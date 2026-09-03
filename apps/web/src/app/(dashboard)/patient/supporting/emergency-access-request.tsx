"use client";

import { useState } from "react";
import {
  useMyRequestedEmergencyGrants,
  useRequestEmergencyAccess,
  useRevokeEmergencyAccess,
} from "@/lib/queries/emergency-access";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * §82.11 "emergency access" — a time-boxed escalation for someone who already holds a
 * profile_access grant (next-of-kin/eldercare) but not the separate clinical_access toggle, for
 * the crisis case where the patient can't be reached to flip it themselves. Always 24 hours,
 * always requires a reason, and the patient is notified the moment it's granted — see
 * 20260830112511_emergency_access_grants.sql.
 */
export function EmergencyAccessRequest({ profileId, name }: { profileId: string; name: string }) {
  const { data: requests } = useMyRequestedEmergencyGrants(profileId);
  const requestAccess = useRequestEmergencyAccess();
  const revokeAccess = useRevokeEmergencyAccess();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = (requests ?? []).find((r) => r.revokedAt === null && new Date(r.expiresAt) > new Date());

  if (active) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
        <p className="font-medium text-charcoal-ink">
          You have emergency access to {name}&apos;s health information until{" "}
          {shortDateTime(active.expiresAt)}.
        </p>
        <p className="mt-0.5 text-xs text-charcoal-ink/60">Reason given: {active.reason}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-2"
          disabled={revokeAccess.isPending}
          onClick={() => revokeAccess.mutate(active.id)}
        >
          {revokeAccess.isPending ? "Ending…" : "End it now"}
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Request emergency access
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
      <p className="text-xs text-charcoal-ink/70">
        This gives you 24 hours of read access to {name}&apos;s health information. {name} is told
        immediately, with the reason you give below, and can end it at any time.
      </p>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Not able to reach them, need to check their medications before an ER visit"
        rows={2}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={requestAccess.isPending || reason.trim().length === 0}
          onClick={() => {
            setError(null);
            requestAccess.mutate(
              { profileId, reason: reason.trim() },
              {
                onSuccess: () => setOpen(false),
                onError: (cause) =>
                  setError(cause instanceof Error ? cause.message : "That did not go through."),
              },
            );
          }}
        >
          {requestAccess.isPending ? "Requesting…" : "Confirm request"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
