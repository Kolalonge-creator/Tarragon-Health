"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { markResultDocumentReviewed } from "@/lib/lab-results/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Clinician control to mark an uploaded result document reviewed (interpreted). */
export function MarkResultReviewed({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: async () => {
      const result = await markResultDocumentReviewed({
        documentId,
        note: note.trim() || undefined,
      });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-2">
      <Input
        placeholder="Review note (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="max-w-md text-sm"
      />
      <Button size="sm" disabled={review.isPending} onClick={() => review.mutate()}>
        {review.isPending ? "Saving…" : "Mark reviewed"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
