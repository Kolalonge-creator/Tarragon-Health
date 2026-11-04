"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/form-error";
import { reviewUnsortedDocument } from "./unsorted-document-review-actions";

export function UnsortedDocumentReviewForm({ documentId, patientId }: { documentId: string; patientId: string }) {
  const router = useRouter();
  const id = useId();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await reviewUnsortedDocument({ documentId, patientId, note });
          if (!res.ok) setError(res.error);
          else router.refresh();
        });
      }}
    >
      <Label htmlFor={id}>Your review</Label>
      <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="What you found, and any next step" />
      <Button type="submit" className="min-h-11" disabled={pending || note.trim().length === 0}>
        {pending ? "Saving" : "Mark as reviewed"}
      </Button>
      {error && <FormError id={`${id}-error`} message={error} />}
    </form>
  );
}
