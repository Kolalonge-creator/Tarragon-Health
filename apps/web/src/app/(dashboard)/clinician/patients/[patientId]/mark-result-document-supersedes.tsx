"use client";

import { useState } from "react";
import { useMarkResultDocumentSupersedes } from "@/lib/queries/lab-result-documents";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export interface SupersedeCandidate {
  id: string;
  label: string;
}

/**
 * Module 57.14: "If the laboratory issues a corrected result, the original
 * should remain traceable and the amended result should supersede it
 * appropriately." Only offered for a document that is neither already a
 * correction of something nor already superseded — undoing a mistaken link
 * is still possible, just not from this control (an org staff member can
 * clear it via the same mutation with null, exposed here as "Undo").
 */
export function MarkResultDocumentSupersedes({
  documentId,
  candidates,
}: {
  documentId: string;
  candidates: SupersedeCandidate[];
}) {
  const [targetId, setTargetId] = useState("");
  const markSupersedes = useMarkResultDocumentSupersedes();

  if (markSupersedes.isSuccess) {
    return <p className="text-xs text-brand-green">Recorded as a correction.</p>;
  }

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        className="h-8 max-w-[16rem] py-1 text-xs"
      >
        <option value="">This corrects an earlier document…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>
      <Button
        variant="outline"
        size="sm"
        disabled={!targetId || markSupersedes.isPending}
        onClick={() => markSupersedes.mutate({ documentId, supersedesDocumentId: targetId })}
      >
        {markSupersedes.isPending ? "Saving…" : "Mark as correction"}
      </Button>
      {markSupersedes.isError && <p className="text-xs text-red-600">Could not save. Try again.</p>}
    </div>
  );
}
