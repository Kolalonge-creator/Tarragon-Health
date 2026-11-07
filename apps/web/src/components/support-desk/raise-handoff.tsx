"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRaiseHandoff, useSupportHandoffs } from "@/lib/queries/support-desk";
import { HANDOFF_DESTINATION_LABEL } from "@/lib/support-desk/model";

const field = "w-full rounded-md border border-charcoal-ink/15 bg-white px-2 py-1.5 text-sm dark:border-night-ink/20 dark:bg-transparent";

/**
 * Hand a support item to the team that owns the decision (SUP-2). Shows the item's existing hand-offs and their outcome,
 * including the wording support may give the customer. There is no clinical option on purpose: a clinical concern uses
 * the clinical escalation already on the ticket.
 */
export function RaiseHandoff({ source, sourceId }: { source: "support_ticket" | "help_request" | "care_thread" | "complaint"; sourceId: string }) {
  const existing = useSupportHandoffs({ source, sourceId });
  const raise = useRaiseHandoff();
  const [destination, setDestination] = useState("finance");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="space-y-3">
      {(existing.data ?? []).map((h) => (
        <div key={h.id} className="rounded-md border border-charcoal-ink/10 p-2 text-sm dark:border-night-ink/15">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{HANDOFF_DESTINATION_LABEL[h.destination] ?? h.destination}</span>
            <Badge variant={h.status === "outcome_recorded" ? "green" : h.status === "withdrawn" ? "grey" : "amber"}>
              {h.status === "outcome_recorded" ? "Outcome recorded" : h.status === "acknowledged" ? "Taken" : h.status === "withdrawn" ? "Withdrawn" : "Waiting"}
            </Badge>
          </div>
          <p className="mt-1 text-charcoal-ink/70 dark:text-night-ink/70">{h.reason}</p>
          {h.customer_message && (
            <p className="mt-1">
              <span className="font-medium">You may tell the customer:</span> {h.customer_message}
            </p>
          )}
        </div>
      ))}
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setDone(false);
          try {
            await raise.mutateAsync({ source, sourceId, destination, reason });
            setReason("");
            setDone(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not hand this over.");
          }
        }}
      >
        <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Hand to
          <select className={field} value={destination} onChange={(e) => setDestination(e.target.value)}>
            {Object.entries(HANDOFF_DESTINATION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          What you need from them (no clinical detail; give the payment or booking reference if there is one)
          <textarea required minLength={10} rows={3} className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {done && <p role="status" className="text-sm text-brand-green">Handed over. The team will record what they decide here.</p>}
        <Button type="submit" size="sm" variant="outline" disabled={raise.isPending || reason.trim().length < 10}>
          Hand over
        </Button>
      </form>
    </div>
  );
}
