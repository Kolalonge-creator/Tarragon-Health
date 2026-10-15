"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markSideEffectNotesReviewed } from "./side-effect-notes-actions";

/** "Mark these as discussed": stamps only the notes on screen as reviewed. It changes no medicine and raises no alert. */
export function MarkNotesReviewedButton({ patientId, noteIds }: { patientId: string; noteIds: string[] }) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="mt-3 space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markSideEffectNotesReviewed({ patientId, noteIds });
            setFailed(!result.ok);
          })
        }
      >
        {pending ? "Saving…" : "Mark these as discussed"}
      </Button>
      {failed ? <p role="alert" className="text-sm text-red-600">That could not be saved just now. Please try again.</p> : null}
    </div>
  );
}
