"use client";

import { useState } from "react";
import { useMatchResultDocumentToOrder } from "@/lib/queries/lab-result-documents";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export interface CandidateOrder {
  id: string;
  label: string;
}

/**
 * Module 57.12/57.13: a document that arrived with no lab_order link. The
 * candidate list is this patient's own open orders (passed in from the
 * server component, which already fetched them) — the clinician still makes
 * the final call on which one it belongs to, matching 57.8's "clinician
 * remains responsible" posture rather than auto-matching silently.
 */
export function MatchResultToOrder({
  documentId,
  candidates,
}: {
  documentId: string;
  candidates: CandidateOrder[];
}) {
  const [orderId, setOrderId] = useState("");
  const matchMutation = useMatchResultDocumentToOrder();

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-charcoal-ink/50">
        No open order on file for this patient to match against.
      </p>
    );
  }

  if (matchMutation.isSuccess) {
    return <p className="text-xs text-brand-green">Matched to order.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        className="h-8 max-w-[16rem] py-1 text-xs"
      >
        <option value="">Match to order…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>
      <Button
        variant="outline"
        size="sm"
        disabled={!orderId || matchMutation.isPending}
        onClick={() => matchMutation.mutate({ documentId, labOrderId: orderId })}
      >
        {matchMutation.isPending ? "Matching…" : "Match"}
      </Button>
      {matchMutation.isError && <p className="text-xs text-red-600">Could not match. Try again.</p>}
    </div>
  );
}
