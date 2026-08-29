"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { flagDocumentDiscrepancy } from "@/lib/documents/clinician-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Disclosure + small form for flagging a conflict between this document and
 * the patient's existing structured record (patient_document_discrepancies).
 * Always raises a matching clinician_alerts worklist entry — see
 * flag_patient_document_discrepancy.
 */
export function FlagDocumentDiscrepancyForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fieldDescription, setFieldDescription] = useState("");
  const [existingValue, setExistingValue] = useState("");
  const [documentValue, setDocumentValue] = useState("");
  const [conflictingTable, setConflictingTable] = useState("");
  const [error, setError] = useState<string | null>(null);

  const flag = useMutation({
    mutationFn: async () => {
      const result = await flagDocumentDiscrepancy({
        documentId,
        fieldDescription: fieldDescription.trim(),
        existingValue: existingValue.trim() || undefined,
        documentValue: documentValue.trim() || undefined,
        conflictingTable: conflictingTable.trim() || undefined,
      });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      setOpen(false);
      setFieldDescription("");
      setExistingValue("");
      setDocumentValue("");
      setConflictingTable("");
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Flag a discrepancy
      </Button>
    );
  }

  return (
    <div className="max-w-md space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <p className="text-xs font-medium text-charcoal-ink">
        What conflicts with this document?
      </p>
      <Input
        placeholder="e.g. Penicillin allergy stated in this letter"
        value={fieldDescription}
        onChange={(event) => setFieldDescription(event.target.value)}
        className="text-sm"
      />
      <Input
        placeholder="Existing value on file (optional)"
        value={existingValue}
        onChange={(event) => setExistingValue(event.target.value)}
        className="text-sm"
      />
      <Input
        placeholder="Value the document states (optional)"
        value={documentValue}
        onChange={(event) => setDocumentValue(event.target.value)}
        className="text-sm"
      />
      <Input
        placeholder="Conflicting record type, e.g. allergies (optional)"
        value={conflictingTable}
        onChange={(event) => setConflictingTable(event.target.value)}
        className="text-sm"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={flag.isPending || fieldDescription.trim().length === 0}
          onClick={() => flag.mutate()}
        >
          {flag.isPending ? "Flagging…" : "Flag discrepancy"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
