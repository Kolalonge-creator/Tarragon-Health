"use client";

import { useState } from "react";
import {
  useAdminExportRequests,
  useAdminDeletionRequests,
  useAdminCorrectionRequests,
  useReviewExportRequest,
  useReviewDeletionRequest,
  useReviewCorrectionRequest,
  type AdminDataExportRequest,
  type AdminDataDeletionRequest,
  type AdminDataCorrectionRequest,
} from "@/lib/queries/admin-data-rights";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { listQueryState } from "@/lib/queries/list-query-state";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const STATUS_BADGE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  pending: "amber",
  under_review: "blue",
  approved: "blue",
  approved_partial: "blue",
  approved_full: "blue",
  applied: "green",
  fulfilled: "green",
  completed: "green",
  denied: "red",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

function patientLabel(patient: { full_name: string | null; patient_number: string | null } | null) {
  if (!patient) return "Unknown patient";
  return patient.patient_number ? `${patient.full_name ?? "Unnamed"} · ${patient.patient_number}` : patient.full_name ?? "Unnamed";
}

/**
 * A patient's data-export request. "Fulfilled" is a record that an admin
 * has already generated/sent the export out of band (the existing
 * /api/patient/data-export routes serve it back to the patient's own
 * session once this flips) — this control doesn't itself generate or send
 * anything, matching the migration's own "does not itself generate or
 * deliver an export" comment.
 */
function ExportRequestRow({ request }: { request: AdminDataExportRequest }) {
  const review = useReviewExportRequest();
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");
  const isOpen = request.status === "pending" || request.status === "under_review";

  return (
    <li className="space-y-2 border-b border-charcoal-ink/10 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">{patientLabel(request.patient)}</p>
          <p className="text-xs text-charcoal-ink/60">Requested {formatDate(request.requested_at)}</p>
          {request.note && <p className="mt-1 text-xs text-charcoal-ink/70">Note: {request.note}</p>}
          {request.decision_note && (
            <p className="mt-1 text-xs text-charcoal-ink/60">Decision: {request.decision_note}</p>
          )}
        </div>
        <Badge variant={STATUS_BADGE[request.status] ?? "grey"}>{request.status.replace(/_/g, " ")}</Badge>
      </div>

      {isOpen && !denying && (
        <div className="flex flex-wrap items-center gap-2">
          {request.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending}
              onClick={() => review.mutate({ requestId: request.id, status: "under_review" })}
            >
              Start review
            </Button>
          )}
          <Button
            size="sm"
            disabled={review.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Mark fulfilled only after you've generated and sent this patient's export (or confirmed they can now retrieve it themselves). Continue?"
                )
              ) {
                review.mutate({ requestId: request.id, status: "fulfilled" });
              }
            }}
          >
            Mark fulfilled
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDenying(true)}>
            Deny
          </Button>
        </div>
      )}

      {review.isError && (
        <p className="text-xs text-red-600">
          {review.error instanceof Error ? review.error.message : "Couldn't update this request"}
        </p>
      )}

      {isOpen && denying && (
        <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
          <Textarea
            rows={2}
            placeholder="Reason for denying (shown to the patient)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending || note.trim().length === 0}
              onClick={() =>
                review.mutate(
                  { requestId: request.id, status: "denied", decisionNote: note },
                  { onSuccess: () => setDenying(false) }
                )
              }
            >
              {review.isPending ? "Saving…" : "Confirm deny"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDenying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function ExportRequestsSection() {
  const requests = useAdminExportRequests();
  const state = listQueryState({
    isLoading: requests.isLoading,
    isError: requests.isError,
    count: requests.data?.length,
  });
  const all = requests.data ?? [];
  const open = all.filter((r) => r.status === "pending" || r.status === "under_review");
  const closed = all.filter((r) => !open.includes(r));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data export requests</CardTitle>
        <CardDescription>
          §87.8 DSAR self-export. A patient asks for a copy of their data instead of downloading it
          directly, so review it, then run the existing export for them, then mark fulfilled.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {state === "error" && (
          <LoadFailure>
            Export requests could not be loaded. This is not a report that none are open.
          </LoadFailure>
        )}
        {state === "empty" && <p className="text-sm text-charcoal-ink/60">No export requests yet.</p>}
        {state === "ready" && (
          <>
            {open.length > 0 && (
              <ul className="mb-2">
                {open.map((r) => (
                  <ExportRequestRow key={r.id} request={r} />
                ))}
              </ul>
            )}
            {open.length === 0 && <p className="text-sm text-charcoal-ink/60">No open requests.</p>}
            {closed.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-charcoal-ink/60">
                  Resolved ({closed.length})
                </summary>
                <ul className="mt-2">
                  {closed.map((r) => (
                    <ExportRequestRow key={r.id} request={r} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A patient's request to delete data we hold. Deliberately staged, per the
 * migration's own warning that clinical records under mandatory retention
 * cannot simply be deleted on request: a reviewer decides full/partial
 * approval (a partial approval must say what's blocked and why) or denial,
 * then — once the actual deletion/anonymisation work is carried out
 * out-of-band against whichever tables apply — marks the request completed.
 * This control tracks the decision; it never executes a deletion itself.
 */
function DeletionRequestRow({ request }: { request: AdminDataDeletionRequest }) {
  const review = useReviewDeletionRequest();
  const [action, setAction] = useState<"deny" | "partial" | null>(null);
  const [note, setNote] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  // Pre-filled from the full requested list when "Approve (partial)" is
  // opened, but editable — a partial approval must be able to say only SOME
  // of what was requested is blocked, not default to treating the whole
  // request as blocked (which is what approving fully or denying already
  // express).
  const [blockedCategoriesInput, setBlockedCategoriesInput] = useState("");
  const isOpen = request.status === "pending" || request.status === "under_review";
  const isApproved = request.status === "approved_full" || request.status === "approved_partial";

  return (
    <li className="space-y-2 border-b border-charcoal-ink/10 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">{patientLabel(request.patient)}</p>
          <p className="text-xs text-charcoal-ink/60">Requested {formatDate(request.requested_at)}</p>
          {request.reason && <p className="mt-1 text-xs text-charcoal-ink/70">Reason: {request.reason}</p>}
          {request.requested_categories.length > 0 && (
            <p className="mt-1 text-xs text-charcoal-ink/60">
              Categories: {request.requested_categories.join(", ")}
            </p>
          )}
          {request.blocked_categories.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              Blocked categories: {request.blocked_categories.join(", ")}
            </p>
          )}
          {request.blocked_reason && (
            <p className="mt-1 text-xs text-amber-700">Why blocked: {request.blocked_reason}</p>
          )}
          {request.decision_note && (
            <p className="mt-1 text-xs text-charcoal-ink/60">Decision: {request.decision_note}</p>
          )}
        </div>
        <Badge variant={STATUS_BADGE[request.status] ?? "grey"}>{request.status.replace(/_/g, " ")}</Badge>
      </div>

      {isOpen && action === null && (
        <div className="flex flex-wrap items-center gap-2">
          {request.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending}
              onClick={() => review.mutate({ requestId: request.id, status: "under_review" })}
            >
              Start review
            </Button>
          )}
          <Button
            size="sm"
            disabled={review.isPending}
            onClick={() => review.mutate({ requestId: request.id, status: "approved_full" })}
          >
            Approve (full)
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setBlockedCategoriesInput(request.requested_categories.join(", "));
              setAction("partial");
            }}
          >
            Approve (partial)
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAction("deny")}>
            Deny
          </Button>
        </div>
      )}

      {isApproved && (
        <Button
          size="sm"
          disabled={review.isPending}
          onClick={() => {
            if (
              window.confirm(
                "Mark completed only once the approved deletion/anonymisation has actually been carried out. Continue?"
              )
            ) {
              review.mutate({ requestId: request.id, status: "completed" });
            }
          }}
        >
          Mark completed
        </Button>
      )}

      {review.isError && (
        <p className="text-xs text-red-600">
          {review.error instanceof Error ? review.error.message : "Couldn't update this request"}
        </p>
      )}

      {isOpen && action === "deny" && (
        <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
          <Textarea
            rows={2}
            placeholder="Reason for denying (shown to the patient)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending || note.trim().length === 0}
              onClick={() =>
                review.mutate(
                  { requestId: request.id, status: "denied", decisionNote: note },
                  { onSuccess: () => setAction(null) }
                )
              }
            >
              {review.isPending ? "Saving…" : "Confirm deny"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isOpen && action === "partial" && (
        <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
          <Label htmlFor={`blocked-categories-${request.id}`}>
            Which requested categories can&apos;t be deleted? (comma-separated; edit to match what&apos;s
            actually blocked, everything else in the request is treated as approved)
          </Label>
          <Textarea
            id={`blocked-categories-${request.id}`}
            rows={1}
            value={blockedCategoriesInput}
            onChange={(e) => setBlockedCategoriesInput(e.target.value)}
          />
          <Label htmlFor={`blocked-reason-${request.id}`}>Why (e.g. a mandatory clinical-retention category)</Label>
          <Textarea
            id={`blocked-reason-${request.id}`}
            rows={2}
            value={blockedReason}
            onChange={(e) => setBlockedReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                review.isPending ||
                blockedReason.trim().length === 0 ||
                blockedCategoriesInput.trim().length === 0
              }
              onClick={() =>
                review.mutate(
                  {
                    requestId: request.id,
                    status: "approved_partial",
                    blockedReason,
                    blockedCategories: blockedCategoriesInput
                      .split(",")
                      .map((c) => c.trim())
                      .filter(Boolean),
                  },
                  { onSuccess: () => setAction(null) }
                )
              }
            >
              {review.isPending ? "Saving…" : "Confirm partial approval"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function DeletionRequestsSection() {
  const requests = useAdminDeletionRequests();
  const state = listQueryState({
    isLoading: requests.isLoading,
    isError: requests.isError,
    count: requests.data?.length,
  });
  const all = requests.data ?? [];
  const open = all.filter(
    (r) => r.status === "pending" || r.status === "under_review" || r.status === "approved_full" || r.status === "approved_partial"
  );
  const closed = all.filter((r) => !open.includes(r));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data deletion requests</CardTitle>
        <CardDescription>
          §87.11 right to erasure. Some clinical records must be kept under mandatory retention, so a
          partial approval must say what&apos;s blocked and why.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {state === "error" && (
          <LoadFailure>
            Deletion requests could not be loaded. This is not a report that none are open.
          </LoadFailure>
        )}
        {state === "empty" && <p className="text-sm text-charcoal-ink/60">No deletion requests yet.</p>}
        {state === "ready" && (
          <>
            {open.length > 0 && (
              <ul className="mb-2">
                {open.map((r) => (
                  <DeletionRequestRow key={r.id} request={r} />
                ))}
              </ul>
            )}
            {open.length === 0 && <p className="text-sm text-charcoal-ink/60">No open requests.</p>}
            {closed.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-charcoal-ink/60">
                  Resolved ({closed.length})
                </summary>
                <ul className="mt-2">
                  {closed.map((r) => (
                    <DeletionRequestRow key={r.id} request={r} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A patient's request to correct something wrong in their record. Never
 * writes the correction itself — approving here just agrees the record
 * should change; a reviewer makes the actual edit elsewhere (which the
 * existing record_corrections trigger logs separately) and then records
 * what/where in resolution_note before marking applied.
 */
function CorrectionRequestRow({ request }: { request: AdminDataCorrectionRequest }) {
  const review = useReviewCorrectionRequest();
  const [action, setAction] = useState<"deny" | "apply" | null>(null);
  const [note, setNote] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const isOpen = request.status === "pending" || request.status === "under_review";
  const isApproved = request.status === "approved";

  return (
    <li className="space-y-2 border-b border-charcoal-ink/10 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">{patientLabel(request.patient)}</p>
          <p className="text-xs text-charcoal-ink/60">Requested {formatDate(request.requested_at)}</p>
          <p className="mt-1 text-xs text-charcoal-ink/70">Record: {request.record_description}</p>
          <p className="text-xs text-charcoal-ink/70">What&apos;s wrong: {request.what_is_wrong}</p>
          {request.requested_change && (
            <p className="text-xs text-charcoal-ink/70">Requested change: {request.requested_change}</p>
          )}
          {request.decision_note && (
            <p className="mt-1 text-xs text-charcoal-ink/60">Decision: {request.decision_note}</p>
          )}
          {request.resolution_note && (
            <p className="mt-1 text-xs text-charcoal-ink/60">Resolution: {request.resolution_note}</p>
          )}
        </div>
        <Badge variant={STATUS_BADGE[request.status] ?? "grey"}>{request.status.replace(/_/g, " ")}</Badge>
      </div>

      {isOpen && action === null && (
        <div className="flex flex-wrap items-center gap-2">
          {request.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending}
              onClick={() => review.mutate({ requestId: request.id, status: "under_review" })}
            >
              Start review
            </Button>
          )}
          <Button
            size="sm"
            disabled={review.isPending}
            onClick={() => review.mutate({ requestId: request.id, status: "approved" })}
          >
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAction("deny")}>
            Deny
          </Button>
        </div>
      )}

      {isApproved && action !== "apply" && (
        <Button size="sm" onClick={() => setAction("apply")}>
          Mark applied
        </Button>
      )}

      {review.isError && (
        <p className="text-xs text-red-600">
          {review.error instanceof Error ? review.error.message : "Couldn't update this request"}
        </p>
      )}

      {isOpen && action === "deny" && (
        <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
          <Textarea
            rows={2}
            placeholder="Reason for denying (shown to the patient)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending || note.trim().length === 0}
              onClick={() =>
                review.mutate(
                  { requestId: request.id, status: "denied", decisionNote: note },
                  { onSuccess: () => setAction(null) }
                )
              }
            >
              {review.isPending ? "Saving…" : "Confirm deny"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isApproved && action === "apply" && (
        <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
          <Label htmlFor={`resolution-${request.id}`}>What did you change, and where?</Label>
          <Textarea
            id={`resolution-${request.id}`}
            rows={2}
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={review.isPending || resolutionNote.trim().length === 0}
              onClick={() =>
                review.mutate(
                  { requestId: request.id, status: "applied", resolutionNote },
                  { onSuccess: () => setAction(null) }
                )
              }
            >
              {review.isPending ? "Saving…" : "Confirm applied"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function CorrectionRequestsSection() {
  const requests = useAdminCorrectionRequests();
  const state = listQueryState({
    isLoading: requests.isLoading,
    isError: requests.isError,
    count: requests.data?.length,
  });
  const all = requests.data ?? [];
  const open = all.filter((r) => r.status === "pending" || r.status === "under_review" || r.status === "approved");
  const closed = all.filter((r) => !open.includes(r));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data correction requests</CardTitle>
        <CardDescription>
          §87.9 right to rectification. Approving agrees the record should change; the actual edit
          happens elsewhere and gets logged there too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {state === "error" && (
          <LoadFailure>
            Correction requests could not be loaded. This is not a report that none are open.
          </LoadFailure>
        )}
        {state === "empty" && <p className="text-sm text-charcoal-ink/60">No correction requests yet.</p>}
        {state === "ready" && (
          <>
            {open.length > 0 && (
              <ul className="mb-2">
                {open.map((r) => (
                  <CorrectionRequestRow key={r.id} request={r} />
                ))}
              </ul>
            )}
            {open.length === 0 && <p className="text-sm text-charcoal-ink/60">No open requests.</p>}
            {closed.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-charcoal-ink/60">
                  Resolved ({closed.length})
                </summary>
                <ul className="mt-2">
                  {closed.map((r) => (
                    <CorrectionRequestRow key={r.id} request={r} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DataRightsReviewDashboard() {
  return (
    <div className="space-y-6">
      <ExportRequestsSection />
      <DeletionRequestsSection />
      <CorrectionRequestsSection />
    </div>
  );
}
