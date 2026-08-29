"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { archivePatientDocumentAsStaff } from "@/lib/documents/clinician-actions";
import { Button } from "@/components/ui/button";

/** Archives a document out of the working record. archive_patient_document
 * requires a non-empty reason, so this prompts for one before calling it —
 * same window.prompt pattern used for a required reason elsewhere on the
 * platform (see the finance approvals reject flow). */
export function ArchivePatientDocumentButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const archive = useMutation({
    mutationFn: async (reason: string) => {
      const result = await archivePatientDocumentAsStaff(documentId, reason);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  function handleClick() {
    const reason = window.prompt("Reason for archiving this document?");
    if (!reason || !reason.trim()) return;
    archive.mutate(reason.trim());
  }

  return (
    <div>
      <Button size="sm" variant="ghost" className="text-red-700" disabled={archive.isPending} onClick={handleClick}>
        {archive.isPending ? "Archiving…" : "Archive"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
