"use client";

import { useState, type FormEvent } from "react";
import { useLogScreeningCompletion } from "@/lib/queries/screening";
import { logScreeningCompletionSchema } from "@/lib/validation/screening-completion";
import { todayIsoDate } from "@/lib/queries/medications";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { formatPatientDate } from "@/lib/format-date";
/**
 * Lets a patient confirm a screening on their calendar was already done, with
 * the date it happened — the calendar's next-due cycle is then scheduled from
 * that reported date, not from today (see
 * private.refresh_screening_schedule_on_completion). Once confirmed, offers
 * an inline "upload your result" step linked to that confirmation via
 * PatientResultUpload's screeningCompletionId — the same gated (consultation
 * fee) + AI-extracted upload path every other patient self-upload goes
 * through, not a separate one.
 */
export function ConfirmScreeningDoneForm({
  patientId,
  scheduleId,
  screenTypeId,
  screenTypeName,
  alreadyCompleted,
}: {
  patientId: string;
  scheduleId: string;
  screenTypeId: string;
  screenTypeName: string;
  /** True once the schedule row this confirms has status 'completed'. Confirming
   * flips it (via private.refresh_screening_schedule_on_completion) the moment
   * the mutation succeeds, so this turns true on the very next refetch — well
   * before the patient has read the "marked as done" message or chosen whether
   * to upload a result. Only used to decide whether to show nothing at all for
   * a row that was ALREADY completed before this component ever mounted;
   * once `completionId` is set locally, the success/upload panel stays up
   * regardless of what this prop says. */
  alreadyCompleted: boolean;
}) {
  const logCompletion = useLogScreeningCompletion();

  const [open, setOpen] = useState(false);
  const [performedDate, setPerformedDate] = useState("");
  const [note, setNote] = useState("");
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);

    const parsed = logScreeningCompletionSchema.safeParse({
      screen_type_id: screenTypeId,
      schedule_id: scheduleId,
      performed_date: performedDate,
      note: note || undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    try {
      const id = await logCompletion.mutateAsync({ ...parsed.data, patientId });
      setCompletionId(id);
    } catch {
      // Mutation error surfaces via logCompletion.error below.
    }
  }

  const confirmError = validationError ?? (logCompletion.error as Error | null)?.message ?? null;

  if (!open) {
    // Nothing to offer for a row that was already completed before this
    // component mounted. A row THIS session just confirmed also reaches
    // status 'completed' (the DB trigger flips it immediately), but
    // completionId being set takes it past this branch instead, so its
    // success/upload panel below stays visible.
    if (alreadyCompleted && !completionId) return null;
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        I&apos;ve done this test
      </Button>
    );
  }

  if (completionId) {
    return (
      <div className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
        <p className="text-sm text-brand-green dark:text-brand-green-bright">
          Marked as done for {formatPatientDate(performedDate)}. We&apos;ve scheduled
          your next {screenTypeName.toLowerCase()} from that date.
        </p>
        {!uploadSuccess ? (
          <div className="space-y-2">
            <PatientResultUpload
              screeningCompletionId={completionId}
              label="Upload your result (optional)"
              onUploaded={() => setUploadSuccess(true)}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Skip for now
            </Button>
          </div>
        ) : (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Result uploaded. Your care team will review it.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleConfirm}
      className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor={`performed-date-${scheduleId}`}>Date the test was done</Label>
        <Input
          id={`performed-date-${scheduleId}`}
          type="date"
          max={todayIsoDate()}
          value={performedDate}
          onChange={(event) => setPerformedDate(event.target.value)}
          required
        />
      </div>
      <Textarea
        placeholder="Note (optional): e.g. which lab"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
      />
      {confirmError && <p className="text-xs text-red-600 dark:text-red-300">{confirmError}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={logCompletion.isPending}>
          {logCompletion.isPending ? "Saving…" : "Confirm completed"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
