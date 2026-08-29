"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { reviewDocumentClassification } from "@/lib/documents/clinician-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Resolves a classification mismatch on one document (OCR's suggested type
 * disagreed with the declared document_type). Recording a review verdict
 * never changes the declared document_type — a wrong filing is corrected by
 * uploading a new version, not by this control.
 */
export function DocumentClassificationReviewForm({ extractionId }: { extractionId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: async () => {
      const result = await reviewDocumentClassification(extractionId, note.trim());
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="mt-2 space-y-2">
      <Input
        placeholder="Review note (e.g. confirmed filed type is correct)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="max-w-md text-sm"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={review.isPending || note.trim().length === 0}
        onClick={() => review.mutate()}
      >
        {review.isPending ? "Saving…" : "Confirm review"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
