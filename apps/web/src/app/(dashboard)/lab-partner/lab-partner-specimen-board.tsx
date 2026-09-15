"use client";

import { useState } from "react";
import {
  useLabPartnerSpecimens,
  useAdvanceLabSpecimen,
  useRejectLabSpecimen,
  LAB_SPECIMEN_STATUS_LABEL,
  LAB_SPECIMEN_REJECTION_REASON_LABEL,
  type LabSpecimen,
  type LabSpecimenRejectionReason,
} from "@/lib/queries/lab-specimens";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Forward order a specimen normally moves through — mirrors
 * lab_partner_update_specimen_status's own rank array, so "Advance" always
 * offers the single next real step rather than letting staff skip one. */
const FORWARD_ORDER = ["pending_collection", "collected", "in_transit", "received", "processing", "completed"] as const;

const STATUS_VARIANT: Record<LabSpecimen["status"], "green" | "amber" | "blue" | "grey"> = {
  pending_collection: "amber",
  collected: "blue",
  in_transit: "blue",
  received: "blue",
  processing: "blue",
  completed: "green",
  rejected: "amber",
};

function nextStatus(current: LabSpecimen["status"]) {
  const idx = FORWARD_ORDER.indexOf(current as (typeof FORWARD_ORDER)[number]);
  if (idx === -1 || idx === FORWARD_ORDER.length - 1) return null;
  return FORWARD_ORDER[idx + 1];
}

function SpecimenRow({ specimen }: { specimen: LabSpecimen }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<LabSpecimenRejectionReason>("insufficient_sample");
  const advance = useAdvanceLabSpecimen();
  const reject = useRejectLabSpecimen();

  const next = nextStatus(specimen.status);
  const isTerminal = specimen.status === "completed" || specimen.status === "rejected";

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-charcoal-ink">{specimen.specimen_number}</span>
        <Badge variant={STATUS_VARIANT[specimen.status]}>
          {specimen.status === "rejected" ? "Rejected" : LAB_SPECIMEN_STATUS_LABEL[specimen.status]}
        </Badge>
        {specimen.collection_method === "home_collection" && <Badge variant="grey">Home collection</Badge>}
        {specimen.recollection_of && <Badge variant="blue">Recollection</Badge>}
      </div>

      {specimen.status === "rejected" && specimen.rejection_reason && (
        <p className="text-xs text-charcoal-ink/60">
          {LAB_SPECIMEN_REJECTION_REASON_LABEL[specimen.rejection_reason]}
          {specimen.rejection_notes ? ` — ${specimen.rejection_notes}` : ""}
        </p>
      )}

      {!isTerminal && (
        <div className="flex flex-wrap items-center gap-2">
          {next && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={advance.isPending}
              onClick={() => advance.mutate({ specimenId: specimen.id, status: next })}
            >
              {advance.isPending ? "Updating…" : `Mark ${LAB_SPECIMEN_STATUS_LABEL[next].toLowerCase()}`}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-red-700"
            onClick={() => setRejecting((v) => !v)}
          >
            Reject sample
          </Button>
        </div>
      )}

      {rejecting && (
        <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
          <select
            className="h-8 w-full rounded-md border border-charcoal-ink/15 px-2 text-xs"
            value={reason}
            onChange={(e) => setReason(e.target.value as LabSpecimenRejectionReason)}
          >
            {(Object.keys(LAB_SPECIMEN_REJECTION_REASON_LABEL) as LabSpecimenRejectionReason[]).map((r) => (
              <option key={r} value={r}>
                {LAB_SPECIMEN_REJECTION_REASON_LABEL[r]}
              </option>
            ))}
          </select>
          <p className="text-xs text-charcoal-ink/60">
            A new sample request opens automatically for the patient once you reject this one.
          </p>
          {(reject.error as Error | null)?.message && (
            <p className="text-xs text-red-600">{(reject.error as Error).message}</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={reject.isPending}
            onClick={() =>
              reject.mutate(
                { specimenId: specimen.id, reason },
                { onSuccess: () => setRejecting(false) },
              )
            }
          >
            {reject.isPending ? "Rejecting…" : "Confirm rejection"}
          </Button>
        </div>
      )}
    </li>
  );
}

/** §56.9/§56.10/§56.13 — the lab's own specimen worklist: every specimen
 * tracked for orders routed to this lab, with one-tap forward progress and
 * rejection-with-automatic-recollection. RLS (lab_specimens_select) scopes
 * this to the caller's own provider_id, same as LabPartnerWorklist. */
export function LabPartnerSpecimenBoard() {
  const { data, isLoading, isError } = useLabPartnerSpecimens();
  const open = (data ?? []).filter((s) => s.status !== "completed" && s.status !== "rejected");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Samples</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load your samples.</p>}
          {data && open.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No samples in progress right now.</p>
          )}
          {open.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {open.map((s) => (
                <SpecimenRow key={s.id} specimen={s} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
