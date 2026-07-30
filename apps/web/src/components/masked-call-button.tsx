"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { requestMaskedCall, endMaskedCall } from "@/lib/masked-calls/actions";

type MaskedCallContext = "care_coordination" | "clinical_follow_up" | "escalation_contact";

/**
 * Requests a masked/proxy call (Twilio Proxy — see
 * lib/twilio/proxy-client.ts) to the named staff member or patient. Renders
 * unconditionally, same "always show the button, fail gracefully on click"
 * shape as StartVirtualReviewButton for Zoom — no separate configured-check
 * is fetched up front, since the server action already tells us.
 */
export function MaskedCallButton({
  patientId,
  staffProfileId,
  otherPartyLabel,
  context,
  escalationId,
}: {
  patientId: string;
  staffProfileId: string;
  otherPartyLabel: string;
  context: MaskedCallContext;
  escalationId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [call, setCall] = useState<{ sessionId: string; dialNumber: string } | null>(null);
  const [dormant, setDormant] = useState(false);

  if (dormant) {
    return (
      <p className="text-xs text-charcoal-ink/60">Masked calling isn&apos;t set up yet — check back soon.</p>
    );
  }

  if (call) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-charcoal-ink">
          Dial <span className="font-medium">{call.dialNumber}</span> to reach {otherPartyLabel} — this
          number connects only this call and expires automatically.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await endMaskedCall(call.sessionId);
              setCall(null);
            })
          }
        >
          {isPending ? "Ending…" : "End call"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const outcome = await requestMaskedCall({
              patientId,
              staffProfileId,
              context,
              escalationId,
            });
            if (!outcome) return;
            if ("error" in outcome) {
              setError(outcome.error);
            } else if (!outcome.configured) {
              setDormant(true);
            } else {
              setCall({ sessionId: outcome.sessionId, dialNumber: outcome.dialNumber });
            }
          })
        }
      >
        {isPending ? "Connecting…" : `Call ${otherPartyLabel}`}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
