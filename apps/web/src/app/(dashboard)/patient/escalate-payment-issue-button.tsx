"use client";

import { useState } from "react";
import { useStartThread } from "@/lib/queries/care-messages";
import { Button } from "@/components/ui/button";

/**
 * §91.10 payment-support escalation. Reuses the existing in-app care-message
 * system (start_care_thread) rather than a new support-ticket table — per
 * CLAUDE.md, two-way patient<->care-team contact is in-app only, never
 * WhatsApp, and this is that same channel, not a special case.
 */
export function EscalatePaymentIssueButton({ subscriptionId }: { subscriptionId: string }) {
  const startThread = useStartThread();
  const [sent, setSent] = useState(false);

  if (sent) {
    return <p className="text-xs text-brand-green">Sent — the care team will follow up.</p>;
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={startThread.isPending}
        onClick={() =>
          startThread.mutate(
            {
              subject: "Payment issue",
              body: `My payment for subscription ${subscriptionId} keeps failing and I need help sorting it out.`,
            },
            { onSuccess: () => setSent(true) },
          )
        }
      >
        {startThread.isPending ? "Sending…" : "Message the care team"}
      </Button>
      {startThread.isError && <p className="pt-1 text-xs text-red-600">Could not send — try again.</p>}
    </div>
  );
}
