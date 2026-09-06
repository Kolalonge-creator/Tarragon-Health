"use client";

import { useActionState, useRef, useState } from "react";
import { resolveSafeguardingConcern } from "./safeguarding-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";

/**
 * `canResolve` mirrors private.can_review_safeguarding_concern (Tier 3+ or
 * the Clinical Director) — it decides whether "Move to review" / "Close"
 * are offered at all, since the DB trigger requires that authority for ANY
 * status transition on the shared safeguarding_concerns table, not only
 * closing. enforce_safeguarding_concern_attribution is the real enforcement
 * boundary. Everyone with access to this worklist (any org clinical staff)
 * can still add a review-outcome/corrective-action note without changing
 * status.
 *
 * Closing a safeguarding concern is the one action here that ends a case
 * about somebody's safety, so it goes through a confirmation that says what
 * closing means, rather than firing on the first click. Saving a note and
 * moving a case into review are both recoverable and stay single-click.
 */
export function ResolveSafeguardingConcernForm({
  concernId,
  canResolve,
  patientName,
  categoryLabel,
}: {
  concernId: string;
  canResolve: boolean;
  patientName: string;
  categoryLabel: string;
}) {
  const [state, formAction, pending] = useActionState(resolveSafeguardingConcern, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  // The status the next submit carries. A hidden field written imperatively
  // rather than the submitter button's own value, so the confirm dialog can
  // submit the same form; writing it through React state would not have
  // flushed to the DOM before requestSubmit reads the form.
  const statusRef = useRef<HTMLInputElement>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  function submitWith(next: string) {
    if (statusRef.current) statusRef.current.value = next;
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-wrap items-end gap-2 rounded-md bg-cloud-mist/40 p-3"
    >
      <input type="hidden" name="concernId" value={concernId} />
      <input ref={statusRef} type="hidden" name="status" defaultValue="" />
      <div className="flex-1 space-y-1">
        <label className="text-xs text-charcoal-ink/60" htmlFor={`outcome-${concernId}`}>
          Review outcome (required to close)
        </label>
        <textarea
          id={`outcome-${concernId}`}
          name="reviewOutcome"
          rows={1}
          maxLength={2000}
          className="w-full rounded-md border border-charcoal-ink/15 p-1.5 text-xs"
        />
      </div>
      <div className="flex-1 space-y-1">
        <label className="text-xs text-charcoal-ink/60" htmlFor={`action-${concernId}`}>
          Corrective action (optional)
        </label>
        <textarea
          id={`action-${concernId}`}
          name="correctiveAction"
          rows={1}
          maxLength={2000}
          className="w-full rounded-md border border-charcoal-ink/15 p-1.5 text-xs"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => submitWith("")}
      >
        Save note
      </Button>
      {canResolve ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => submitWith("under_review")}
          >
            Move to review
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => setConfirmingClose(true)}
          >
            Close
          </Button>
        </>
      ) : (
        <span className="text-xs text-charcoal-ink/60">
          Only a Tier 3+ clinician or the Clinical Director can move this into review or close it
        </span>
      )}
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}

      <ConfirmDialog
        open={confirmingClose}
        title="Close this safeguarding concern?"
        description="Closing records that this concern has been reviewed and acted on, and takes it off the open worklist. Only reopen it by raising a new concern."
        confirmLabel="Close the concern"
        cancelLabel="Keep it open"
        destructive
        onConfirm={() => {
          setConfirmingClose(false);
          submitWith("closed");
        }}
        onCancel={() => setConfirmingClose(false)}
      >
        <ConfirmDialogFacts
          rows={[
            { label: "Patient", value: patientName },
            { label: "Concern", value: categoryLabel },
          ]}
        />
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          The review outcome you have typed above is saved with it. A concern cannot be closed
          without one.
        </p>
      </ConfirmDialog>
    </form>
  );
}
