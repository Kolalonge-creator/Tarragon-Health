"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startVirtualReview } from "./actions";

/**
 * Level 4 pre-referral triage call — doctor <-> patient, to decide whether
 * a referral is even needed before creating one. Zoom-backed
 * (docs/Tarragon_Health_Master_Operating_Plan_v4.md §7).
 */
export function StartVirtualReviewButton({ escalationId }: { escalationId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ hostStartUrl: string; patientNotified: boolean } | null>(null);

  if (result) {
    return (
      <div className="space-y-1">
        <a href={result.hostStartUrl} target="_blank" rel="noopener noreferrer">
          <Button size="sm">Join as host</Button>
        </a>
        <p className="text-xs text-charcoal-ink/60">
          {result.patientNotified
            ? "The patient has been told in the app that the call is ready."
            : "Could not notify the patient in the app. Tell them directly that the call is ready."}
        </p>
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
            const outcome = await startVirtualReview(escalationId);
            if (!outcome) return;
            if ("error" in outcome) {
              setError(outcome.error);
            } else {
              setResult({ hostStartUrl: outcome.hostStartUrl, patientNotified: outcome.patientNotified });
            }
          })
        }
      >
        {isPending ? "Starting…" : "Start virtual review"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
