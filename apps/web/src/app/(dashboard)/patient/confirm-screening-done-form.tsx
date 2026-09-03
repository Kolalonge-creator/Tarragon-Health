"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLogScreeningCompletion } from "@/lib/queries/screening";
import { useUploadOwnResultDocument } from "@/lib/queries/lab-result-documents";
import { logScreeningCompletionSchema } from "@/lib/validation/screening-completion";
import { RESULT_DOC_ACCEPT, validateResultDocFile } from "@/lib/validation/lab-result-documents";
import { todayIsoDate } from "@/lib/queries/medications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Lets a patient confirm a screening on their calendar was already done, with
 * the date it happened — the calendar's next-due cycle is then scheduled from
 * that reported date, not from today (see
 * private.refresh_screening_schedule_on_completion). Once confirmed, offers
 * an inline "upload your result" step linked to that confirmation.
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
  const router = useRouter();
  const logCompletion = useLogScreeningCompletion();
  const uploadResult = useUploadOwnResultDocument();

  const [open, setOpen] = useState(false);
  const [performedDate, setPerformedDate] = useState("");
  const [note, setNote] = useState("");
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleUpload(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);
    if (!file || !completionId) return;
    const fileError = validateResultDocFile(file);
    if (fileError) {
      setValidationError(fileError);
      return;
    }
    uploadResult.mutate(
      { file, note, screeningCompletionId: completionId },
      {
        onSuccess: () => {
          setUploadSuccess(true);
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          router.refresh();
        },
      }
    );
  }

  const confirmError = validationError ?? (logCompletion.error as Error | null)?.message ?? null;
  const uploadError = (uploadResult.error as Error | null)?.message ?? null;

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
      <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
        <p className="text-sm text-brand-green">
          Marked as done for {new Date(performedDate).toLocaleDateString()}. We&apos;ve scheduled
          your next {screenTypeName.toLowerCase()} from that date.
        </p>
        {!uploadSuccess ? (
          <form onSubmit={handleUpload} className="space-y-2">
            <Label htmlFor={`result-file-${scheduleId}`}>Upload your result (optional)</Label>
            <Input
              id={`result-file-${scheduleId}`}
              ref={fileInputRef}
              type="file"
              accept={RESULT_DOC_ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {(validationError || uploadError) && (
              <p className="text-xs text-red-600">{validationError ?? uploadError}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!file || uploadResult.isPending}>
                {uploadResult.isPending ? "Uploading…" : "Upload result"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Skip for now
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-charcoal-ink/60">
            Result uploaded. Your care team will review it.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleConfirm}
      className="space-y-2 rounded-md border border-charcoal-ink/10 p-3"
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
      {confirmError && <p className="text-xs text-red-600">{confirmError}</p>}
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
