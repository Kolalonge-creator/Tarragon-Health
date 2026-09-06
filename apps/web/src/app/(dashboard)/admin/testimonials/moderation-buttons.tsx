"use client";

import { useActionState, useRef, useState } from "react";
import { moderateTestimonial } from "./actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";

/**
 * Publishing puts a real patient's words and display name on the public
 * marketing site. The buttons used to fire on one click with
 * `consent_to_publish` never shown anywhere on the page, so the one fact that
 * decides whether publishing is allowed at all was invisible to the person
 * deciding. Publishing is now blocked outright without recorded consent, and
 * confirmed with the quote and the name in front of the reviewer when it is
 * present. Declining stays a single click: it publishes nothing.
 */
export function TestimonialModerationButtons({
  id,
  displayName,
  quote,
  consentToPublish,
}: {
  id: string;
  displayName: string;
  quote: string;
  consentToPublish: boolean;
}) {
  const [state, formAction, pending] = useActionState(moderateTestimonial, undefined);
  const publishRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <form ref={publishRef} action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="published" />
        <Button
          type="button"
          size="sm"
          disabled={pending || !consentToPublish}
          onClick={() => setConfirming(true)}
        >
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
      {!consentToPublish && (
        <span className="text-xs text-charcoal-ink/70">
          This patient did not consent to publication, so it cannot be published. Decline it.
        </span>
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}

      <ConfirmDialog
        open={confirming}
        title="Publish this quote on the public site?"
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
            { label: "Consent to publish", value: consentToPublish ? "Recorded" : "Not recorded" },
          ]}
        />
        <p className="rounded-lg border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15">
          &ldquo;{quote}&rdquo;
        </p>
      </ConfirmDialog>
    </div>
  );
}
