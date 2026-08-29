"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { triggerOutreachAction } from "../actions";

/**
 * Staff-initiated outreach launch (spec §41.7/§41.14) — e.g. kicking off
 * "Know Your Blood Pressure Month" for the Hypertension registry. Only
 * members with an open care gap right now get queued; re-clicking is safe
 * (the underlying care_outreach_tasks unique index no-ops a repeat).
 */
export function OutreachButton({ populationId }: { populationId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await triggerOutreachAction(populationId);
            if (result?.error) {
              setMessage(result.error);
            } else {
              const n = result?.queued ?? 0;
              setMessage(
                n === 0
                  ? "No members currently have an open care gap."
                  : `Queued outreach for ${n} patient${n === 1 ? "" : "s"} — see the Outreach worklist.`
              );
            }
          })
        }
      >
        {pending ? "Queuing…" : "Queue outreach for open gaps"}
      </Button>
      {message && <p className="text-xs text-charcoal-ink/60">{message}</p>}
    </div>
  );
}
