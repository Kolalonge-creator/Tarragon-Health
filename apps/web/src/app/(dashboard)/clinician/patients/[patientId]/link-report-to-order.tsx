"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLabOrderLinkCandidates, type LabOrderLinkCandidate } from "@/lib/queries/lab-orders";
import { linkReportToLabOrder } from "@/lib/lab-orders/report-link-actions";

/** Value of the "answers no request" option; never a uuid, so it cannot collide with an order id. */
const NO_REQUEST = "none";

const LINK_SOURCE_LABEL: Record<string, string> = {
  upload: "named at upload",
  patient: "chosen by the patient",
  staff: "linked by the care team",
  auto: "matched automatically",
};

function candidateLabel(c: LabOrderLinkCandidate): string {
  const notes = [
    c.tests_match ? "tests match" : null,
    c.status === "resulted" ? "already resulted" : null,
    c.is_linked ? "current" : null,
  ].filter(Boolean);
  return `${c.order_number ?? "Request"}: ${c.label}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/**
 * Request to report, staff side: which test request this uploaded report answers. Shows the current link (and whether the
 * request is now resulted), and lets staff set, change or clear it. The candidates come from public.lab_order_link_candidates,
 * which flags the requests whose tests overlap the report's; the database refuses another patient's or a cancelled request
 * and closes the request itself once the linked report is filed.
 */
export function LinkReportToOrder({
  clinicalDocumentId,
  patientId,
  linkedOrder,
  linkSource,
}: {
  clinicalDocumentId: string;
  patientId: string;
  linkedOrder: { id: string; orderNumber: string | null; status: string } | null;
  linkSource: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState("");
  const { data: candidates, isLoading, isError } = useLabOrderLinkCandidates(editing ? clinicalDocumentId : null);

  const save = useMutation({
    mutationFn: async () => {
      const result = await linkReportToLabOrder({
        documentId: clinicalDocumentId,
        labOrderId: choice === NO_REQUEST ? null : choice,
        patientId,
      });
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      setEditing(false);
      setChoice("");
      queryClient.invalidateQueries({ queryKey: ["lab-order-reports", patientId] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders", patientId] });
      queryClient.invalidateQueries({ queryKey: ["lab-order-link-candidates", clinicalDocumentId] });
      router.refresh();
    },
  });

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {linkedOrder ? (
          <>
            <span className="text-charcoal-ink/70">
              Answers test request {linkedOrder.orderNumber ?? "(no number)"}
              {linkSource && LINK_SOURCE_LABEL[linkSource] ? `, ${LINK_SOURCE_LABEL[linkSource]}` : ""}
            </span>
            {linkedOrder.status === "resulted" && <Badge variant="green">Result back</Badge>}
          </>
        ) : (
          <span className="text-charcoal-ink/60">
            {linkSource === "declined" ? "Recorded as not answering a test request" : "Not linked to a test request"}
          </span>
        )}
        {!editing && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditing(true)}>
            {linkedOrder ? "Change" : "Link to a request"}
          </Button>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          {isLoading ? (
            <span className="text-charcoal-ink/60">Loading requests…</span>
          ) : isError ? (
            <span className="text-red-600">Could not load this patient&apos;s test requests.</span>
          ) : (
            <Select
              aria-label="Test request this report answers"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="h-8 max-w-[22rem] py-1 text-xs"
            >
              <option value="">Choose a test request…</option>
              {(candidates ?? []).map((c) => (
                <option key={c.lab_order_id} value={c.lab_order_id}>
                  {candidateLabel(c)}
                </option>
              ))}
              <option value={NO_REQUEST}>This report answers no test request</option>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!choice || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {save.isError && <p className="w-full text-red-600">{(save.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}
