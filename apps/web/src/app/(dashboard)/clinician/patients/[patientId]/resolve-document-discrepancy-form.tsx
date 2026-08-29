"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { resolveDocumentDiscrepancy } from "@/lib/documents/clinician-actions";
import { DISCREPANCY_RESOLUTION_STATUSES } from "@/lib/validation/patient-document-discrepancies";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STATUS_LABEL: Record<(typeof DISCREPANCY_RESOLUTION_STATUSES)[number], string> = {
  document_confirmed_correct: "Document is correct — update the record",
  existing_confirmed_correct: "Existing record is correct — document is outdated",
  both_valid: "Both are valid — not actually a conflict",
  dismissed: "Dismiss — flagged in error",
};

/** Resolves one open discrepancy. One-shot: resolve_patient_document_discrepancy
 * rejects a second resolution once resolved_at is set. */
export function ResolveDocumentDiscrepancyForm({ discrepancyId }: { discrepancyId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(DISCREPANCY_RESOLUTION_STATUSES[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resolve = useMutation({
    mutationFn: async () => {
      const result = await resolveDocumentDiscrepancy(discrepancyId, status, note.trim());
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="mt-2 max-w-md space-y-2">
      <Select value={status} onChange={(event) => setStatus(event.target.value)}>
        {DISCREPANCY_RESOLUTION_STATUSES.map((value) => (
          <option key={value} value={value}>
            {STATUS_LABEL[value]}
          </option>
        ))}
      </Select>
      <Textarea
        placeholder="Resolution note (required)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="text-sm"
        rows={2}
      />
      <Button
        size="sm"
        disabled={resolve.isPending || note.trim().length === 0}
        onClick={() => resolve.mutate()}
      >
        {resolve.isPending ? "Resolving…" : "Resolve"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
