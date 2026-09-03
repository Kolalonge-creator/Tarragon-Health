"use client";

import { useState, type FormEvent } from "react";
import { useDeclineScreeningSchedule } from "@/lib/queries/screening";
import { declineScreeningSchema } from "@/lib/validation/screening-decline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Lets a patient decline a recommended screening instead of leaving it
 * pending forever — closes the gap where a "no thanks" had no way to stop
 * the graduated reminder ladder or the care-coordinator overdue-outreach
 * queue from nagging about it indefinitely.
 */
export function DeclineScreeningForm({
  patientId,
  scheduleId,
}: {
  patientId: string;
  scheduleId: string;
}) {
  const declineSchedule = useDeclineScreeningSchedule();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  async function handleDecline(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);

    const parsed = declineScreeningSchema.safeParse({ schedule_id: scheduleId, reason });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    try {
      await declineSchedule.mutateAsync({ ...parsed.data, patientId });
      setDeclined(true);
    } catch {
      // Mutation error surfaces via declineSchedule.error below.
    }
  }

  if (declined) {
    return (
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Marked as declined. Your care team can see this and follow up if needed.
      </p>
    );
  }

  const error = validationError ?? (declineSchedule.error as Error | null)?.message ?? null;

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Not right for me
      </Button>
    );
  }

  return (
    <form onSubmit={handleDecline} className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <Textarea
        placeholder="Let us know why (e.g. already had this elsewhere, not applicable to me)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={declineSchedule.isPending}>
          {declineSchedule.isPending ? "Saving…" : "Confirm decline"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
