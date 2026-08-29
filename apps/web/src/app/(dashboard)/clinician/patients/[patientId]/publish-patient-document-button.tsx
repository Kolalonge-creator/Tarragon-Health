"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { publishClinicianUploadedDocument } from "@/lib/documents/clinician-actions";
import { Button } from "@/components/ui/button";

/** Moves a scanned-clean-but-not-yet-published document into the working
 * record (public.publish_patient_document requires status='validated'). */
export function PublishPatientDocumentButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: async () => {
      const result = await publishClinicianUploadedDocument(documentId);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div>
      <Button size="sm" variant="outline" disabled={publish.isPending} onClick={() => publish.mutate()}>
        {publish.isPending ? "Publishing…" : "Publish to record"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
