"use client";

import { useState } from "react";
import {
  useOrgDeletionRequests,
  useProcessDeletionRequest,
  useRejectDeletionRequest,
  type DataDeletionRequestWithPatient,
} from "@/lib/queries/data-deletion-requests";
import {
  DATA_DELETION_SCOPE_LABEL,
  DATA_DELETION_STATUS_LABEL,
  DATA_DELETION_STATUS_BADGE_VARIANT,
} from "@/lib/device-data-deletion-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

const OPEN_STATUSES = new Set(["requested", "in_progress"]);

function RequestRow({ request }: { request: DataDeletionRequestWithPatient }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const process = useProcessDeletionRequest();
  const reject = useRejectDeletionRequest();

  const isOpen = OPEN_STATUSES.has(request.status);

  return (
    <li className="space-y-2 border-b border-charcoal-ink/10 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">
            {request.patient?.full_name ?? "Unknown patient"}
            {request.patient?.patient_number ? ` · ${request.patient.patient_number}` : ""}
          </p>
          <p className="text-xs text-charcoal-ink/60">
            {DATA_DELETION_SCOPE_LABEL[request.scope]}, requested {formatDate(request.requested_at)}
          </p>
          {request.reason && (
            <p className="mt-1 text-xs text-charcoal-ink/70">Reason: {request.reason}</p>
          )}
        </div>
        <Badge variant={DATA_DELETION_STATUS_BADGE_VARIANT[request.status]}>
          {DATA_DELETION_STATUS_LABEL[request.status]}
        </Badge>
      </div>

      {isOpen && !rejecting && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={process.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Process this deletion for ${DATA_DELETION_SCOPE_LABEL[request.scope]}? This cannot be undone.`
                )
              ) {
                process.mutate(request.id);
              }
            }}
          >
            {process.isPending ? "Processing…" : "Process deletion"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}

      {process.isError && (
        <p className="text-xs text-red-600">
          {process.error instanceof Error ? process.error.message : "Couldn't process this request"}
        </p>
      )}

      {isOpen && rejecting && (
        <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
          <Textarea
            rows={2}
            placeholder="Reason for rejecting (shown to the patient)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={reject.isPending || reason.trim().length === 0}
              onClick={() =>
                reject.mutate(
                  { requestId: request.id, reason },
                  { onSuccess: () => setRejecting(false) }
                )
              }
            >
              {reject.isPending ? "Rejecting…" : "Confirm reject"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
          {reject.isError && (
            <p className="text-xs text-red-600">
              {reject.error instanceof Error ? reject.error.message : "Couldn't reject this request"}
            </p>
          )}
        </div>
      )}

      {request.status === "rejected" && request.rejection_reason && (
        <p className="text-xs text-charcoal-ink/60">Rejection note: {request.rejection_reason}</p>
      )}
    </li>
  );
}

/**
 * 55.19 staff processing queue — org-scoped device_data_deletion_requests for
 * device/wearable data. Open requests (requested/in_progress) are shown
 * first with actions; completed/rejected ones stay visible underneath as a
 * record of what was already decided.
 */
export function DataDeletionRequestsDashboard({ organisationId }: { organisationId: string }) {
  const requests = useOrgDeletionRequests(organisationId);

  const all = requests.data ?? [];
  const open = all.filter((r) => OPEN_STATUSES.has(r.status));
  const closed = all.filter((r) => !OPEN_STATUSES.has(r.status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Data deletion requests
        </h1>
        <p className="text-sm text-charcoal-ink/60">
          55.19: patient-initiated requests to delete device/wearable data. Processing deletes
          wearable readings and, depending on scope, disconnects wearables or unpairs Bluetooth
          devices. This never touches a patient&apos;s vitals or medical record.
        </p>
      </div>

      {requests.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {requests.isError && (
        <p className="text-sm text-red-600">Couldn&apos;t load deletion requests.</p>
      )}

      {requests.data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Open ({open.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {open.length === 0 ? (
                <p className="text-sm text-charcoal-ink/60">No open requests.</p>
              ) : (
                <ul>
                  {open.map((r) => (
                    <RequestRow key={r.id} request={r} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {closed.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Resolved</CardTitle>
              </CardHeader>
              <CardContent>
                <ul>
                  {closed.map((r) => (
                    <RequestRow key={r.id} request={r} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
