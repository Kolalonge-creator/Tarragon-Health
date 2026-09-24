"use client";

import { useActionState, useRef, useState } from "react";
import { moderateDoctorTestimonial } from "./actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";

/**
 * Publishing puts a real, named doctor's quote on the public marketing
 * site. Unlike the patient version there is no consent_to_publish column to
 * gate the button on — consent for a doctor testimonial is recorded
 * off-platform and the DB never lets a row exist with a blank
 * consent_reference in the first place (see the create form) — so this
 * confirms with the consent_reference on screen instead, so the reviewer
 * double-checks it's a real record and not a placeholder before publishing.
 */
export function DoctorTestimonialModerationButtons({
  id,
  displayName,
  quote,
  consentReference,
}: {
  id: string;
  displayName: string;
  quote: string;
  consentReference: string;
}) {
  const [state, formAction, pending] = useActionState(moderateDoctorTestimonial, undefined);
  const publishRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <form ref={publishRef} action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="published" />
        <Button type="button" size="sm" disabled={pending} onClick={() => setConfirming(true)}>
          Publish
        </Button>
      </form>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="declined" />
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          Decline
        </Button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}

      <ConfirmDialog
        open={confirming}
        title="Publish this doctor quote on the public site?"
        description="It becomes visible to anyone on the internet, attributed to the display name below. Removing it later does not undo anyone having read it."
        confirmLabel="Publish to the public site"
        cancelLabel="Cancel"
        onConfirm={() => {
          setConfirming(false);
          publishRef.current?.requestSubmit();
        }}
        onCancel={() => setConfirming(false)}
      >
        <ConfirmDialogFacts
          rows={[
            { label: "Shown as", value: displayName },
            { label: "Off-platform consent record", value: consentReference },
          ]}
        />
        <p className="rounded-lg border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15">
          &ldquo;{quote}&rdquo;
        </p>
      </ConfirmDialog>
    </div>
  );
}
