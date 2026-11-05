"use client";

import { useState, type FormEvent } from "react";
import { useDeferScreening } from "@/lib/queries/preventive-plan";
import { DEFER_REASON_LABELS, deferRules, deferScreeningSchema } from "@/lib/validation/preventive-plan";
import { todayIsoDate } from "@/lib/queries/medications";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * T2-12: the patient moves a test to a later date with a reason (travelling, unwell, cost and so on). The reminders start again
 * against the new date; the old date and the reason are kept. Cancelling for good stays on "Not right for me".
 */
export function DeferScreeningForm({ patientId, scheduleId, dueDate }: { patientId: string; scheduleId: string; dueDate: string }) {
  const defer = useDeferScreening(patientId);
  const rules = deferRules();
  const [open, setOpen] = useState(false);
  const [newDue, setNewDue] = useState("");
  const [reasonCode, setReasonCode] = useState(rules.reasonCodes[0] ?? "other");
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);
    const parsed = deferScreeningSchema(todayIsoDate(), dueDate).safeParse({
      schedule_id: scheduleId,
      new_due: newDue,
      reason_code: reasonCode,
      note: note || undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Check the date and the reason");
      return;
    }
    try {
      await defer.mutateAsync(parsed.data);
      setSaved(parsed.data.new_due);
    } catch {
      // shown below from defer.error
    }
  }

  if (saved) {
    return <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Moved. We will remind you again before the new date.</p>;
  }
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Move to a later date
      </Button>
    );
  }
  const error = validationError ?? (defer.error as Error | null)?.message ?? null;
  return (
    <form onSubmit={handleSave} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <label className="block text-xs font-medium">
        New date
        <input
          type="date"
          value={newDue}
          min={todayIsoDate()}
          onChange={(e) => setNewDue(e.target.value)}
          className="mt-1 w-full rounded-md border border-charcoal-ink/20 bg-transparent p-2 text-sm"
        />
      </label>
      <label className="block text-xs font-medium">
        Why
        <select
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          className="mt-1 w-full rounded-md border border-charcoal-ink/20 bg-transparent p-2 text-sm"
        >
          {rules.reasonCodes.map((code) => (
            <option key={code} value={code}>
              {DEFER_REASON_LABELS[code] ?? code}
            </option>
          ))}
        </select>
      </label>
      <Textarea placeholder="Anything your care team should know (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        You can move a test up to {rules.maxPerSchedule} times, up to {rules.maxDaysAhead} days ahead.
      </p>
      {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={defer.isPending}>
          {defer.isPending ? "Saving" : "Move the test"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
