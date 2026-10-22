"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideOutsideRecordAction } from "../actions";

/** Verify, or say why it could not be checked. Either way the file stays out of the structured record: this only labels it. */
export function DecisionForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(outcome: "verified" | "not_verified") {
    setError(null);
    startTransition(async () => {
      const res = await decideOutsideRecordAction({ documentId, outcome, note: note.trim() || undefined });
      if (res.error) setError(res.error);
      // Back to the queue rather than refreshing this page: a refresh would open the file again and write another access-log row for no viewing.
      else router.push("/clinician/worklists");
    });
  }

  return (
    <div className="space-y-3">
      <label htmlFor="check-note" className="block text-sm font-medium text-charcoal-ink">
        Note for the patient (needed if you cannot check it)
      </label>
      <Input id="check-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: the photo is too blurred to read" />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => decide("verified")}>
          I have checked this record
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => decide("not_verified")}>
          I could not check it
        </Button>
      </div>
      <p className="text-xs text-charcoal-ink/60">Your name and the time are recorded as the check, and the patient sees both. Nothing in the file is added to the clinical record.</p>
    </div>
  );
}
