"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { dismissDuplicateFlag } from "./actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";

/**
 * "Not a duplicate" is permanent: the detection sweep
 * (private.sweep_duplicate_patient_candidates) never re-flags a dismissed
 * pair, so a wrong click here means two records for the same person stay
 * apart with nothing left to surface them. It fired on a single click; it now
 * says what dismissing costs and names both records first.
 */
export function DuplicateFlagActions({
  flagId,
  profileIdA,
  profileIdB,
  nameA,
  nameB,
  confidencePct,
}: {
  flagId: string;
  profileIdA: string;
  profileIdB: string;
  nameA: string;
  nameB: string;
  confidencePct: number;
}) {
  const [state, formAction, pending] = useActionState(dismissDuplicateFlag, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center gap-2 pt-1">
      <Link
        href={`/admin/patients/merge?a=${profileIdA}&b=${profileIdB}`}
        className="inline-flex items-center rounded-md bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:bg-deep-forest"
      >
        Review &amp; merge
      </Link>
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="id" value={flagId} />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          Not a duplicate
        </Button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}

      <ConfirmDialog
        open={confirming}
        title="Mark these as two different people?"
        description="This is permanent. The duplicate sweep never flags this pair again, so if they do turn out to be the same person, nothing will surface them a second time."
        confirmLabel="They are different people"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          setConfirming(false);
          formRef.current?.requestSubmit();
        }}
        onCancel={() => setConfirming(false)}
      >
        <ConfirmDialogFacts
          rows={[
            { label: "Record A", value: nameA },
            { label: "Record B", value: nameB },
            { label: "Similarity", value: `${confidencePct}% match` },
          ]}
        />
      </ConfirmDialog>
    </div>
  );
}
