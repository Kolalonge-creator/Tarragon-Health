"use client";

import { useState } from "react";
import {
  useProviderComplaint,
  useProviderComplaintInvestigationNotes,
  useTriageProviderComplaint,
  useOpenInvestigation,
  useAddInvestigationNote,
  useRequestProviderResponse,
  useResolveProviderComplaint,
  useGovernanceReviewProviderComplaint,
  useCloseProviderComplaint,
  useWithdrawProviderComplaint,
} from "@/lib/queries/provider-quality";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const SEVERITIES = ["low", "moderate", "serious", "critical"];
const OUTCOMES = ["upheld", "partially_upheld", "not_upheld", "no_further_action"];

const STAGE_TONE: Record<string, "green" | "amber" | "red" | "grey" | "blue"> = {
  received: "grey",
  triage: "amber",
  investigation: "amber",
  provider_response: "blue",
  resolution: "blue",
  governance_review: "blue",
  closed: "green",
  withdrawn: "grey",
};

export function ComplaintDetailView({
  complaintId,
  callerClinicalStaffId,
  callerIsClinicalDirector,
}: {
  complaintId: string;
  callerClinicalStaffId: string | null;
  callerIsClinicalDirector: boolean;
}) {
  const { data: complaint, isLoading, isError } = useProviderComplaint(complaintId);

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !complaint) {
    return <p className="text-sm text-red-600">Could not load this complaint.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
            {complaint.reference}
          </h1>
          <p className="text-sm text-charcoal-ink/60">
            {complaint.category} · raised {new Date(complaint.created_at).toLocaleDateString()}
          </p>
        </div>
        <Badge variant={STAGE_TONE[complaint.stage] ?? "grey"}>{complaint.stage.replace("_", " ")}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink whitespace-pre-wrap">{complaint.summary}</p>
        </CardContent>
      </Card>

      {complaint.stage === "received" ? (
        <TriageStage complaintId={complaintId} />
      ) : null}

      {complaint.stage === "triage" ? (
        <ReadyToInvestigateStage complaintId={complaintId} severity={complaint.severity} />
      ) : null}

      {complaint.stage === "investigation" ? (
        <InvestigationStage complaintId={complaintId} />
      ) : null}

      {complaint.stage === "provider_response" ? (
        <ProviderResponseStage
          complaintId={complaintId}
          responseRequestedAt={complaint.response_requested_at}
          providerResponse={complaint.provider_response}
        />
      ) : null}

      {complaint.stage === "resolution" ? <ResolutionStage complaintId={complaintId} /> : null}

      {complaint.stage === "governance_review" ? (
        <GovernanceReviewStage
          complaintId={complaintId}
          category={complaint.category}
          callerClinicalStaffId={callerClinicalStaffId}
          callerIsClinicalDirector={callerIsClinicalDirector}
        />
      ) : null}

      {complaint.stage === "closed" ? (
        <Card variant="soft">
          <CardContent className="py-4 text-sm text-charcoal-ink/70">
            <p>
              <span className="font-medium text-charcoal-ink">Outcome:</span>{" "}
              {complaint.outcome?.replace("_", " ") ?? "—"}
            </p>
            {complaint.resolution_summary ? (
              <p className="mt-1">{complaint.resolution_summary}</p>
            ) : null}
            {complaint.governance_notes ? (
              <p className="mt-2 text-xs text-charcoal-ink/50">
                Governance review: {complaint.governance_notes}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {complaint.stage === "withdrawn" ? (
        <Card variant="soft">
          <CardContent className="py-4 text-sm text-charcoal-ink/70">
            Withdrawn{complaint.withdrawn_reason ? `: ${complaint.withdrawn_reason}` : "."}
          </CardContent>
        </Card>
      ) : null}

      {!["closed", "withdrawn"].includes(complaint.stage) ? (
        <WithdrawAction complaintId={complaintId} />
      ) : null}
    </div>
  );
}

function TriageStage({ complaintId }: { complaintId: string }) {
  const triage = useTriageProviderComplaint(complaintId);
  const [severity, setSeverity] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Triage</CardTitle>
        <CardDescription>Assign a severity before this can move to investigation.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-3">
        <div className="w-48">
          <Label htmlFor="severity">Severity</Label>
          <Select id="severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Select…</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          disabled={!severity || triage.isPending}
          onClick={() => triage.mutate(severity)}
        >
          {triage.isPending ? "Saving…" : "Triage"}
        </Button>
        {triage.isError ? <p className="text-xs text-red-600">{(triage.error as Error).message}</p> : null}
      </CardContent>
    </Card>
  );
}

function ReadyToInvestigateStage({
  complaintId,
  severity,
}: {
  complaintId: string;
  severity: string | null;
}) {
  const open = useOpenInvestigation(complaintId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ready for investigation</CardTitle>
        <CardDescription>Triaged as {severity ?? "—"} severity.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" disabled={open.isPending} onClick={() => open.mutate()}>
          {open.isPending ? "Opening…" : "Open investigation"}
        </Button>
      </CardContent>
    </Card>
  );
}

function InvestigationStage({ complaintId }: { complaintId: string }) {
  const { data: notes } = useProviderComplaintInvestigationNotes(complaintId);
  const addNote = useAddInvestigationNote(complaintId);
  const requestResponse = useRequestProviderResponse(complaintId);
  const [note, setNote] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Investigation file</CardTitle>
        <CardDescription>
          Visible to handlers only — never to the subject provider, even once they can see the
          complaint itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {(notes ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/50">No notes yet.</p>
          ) : (
            (notes ?? []).map((n) => (
              <div key={n.id} className="rounded-md border border-charcoal-ink/10 p-2 text-sm">
                <p className="text-charcoal-ink">{n.note}</p>
                <p className="mt-1 text-xs text-charcoal-ink/40">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
        <div className="space-y-2">
          <Textarea
            placeholder="Add an investigation note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          <Button
            type="button"
            size="sm"
            disabled={!note.trim() || addNote.isPending}
            onClick={() => {
              addNote.mutate(note, { onSuccess: () => setNote("") });
            }}
          >
            {addNote.isPending ? "Saving…" : "Add note"}
          </Button>
        </div>
        <div className="border-t border-charcoal-ink/10 pt-3">
          <Button
            type="button"
            disabled={(notes ?? []).length === 0 || requestResponse.isPending}
            onClick={() => requestResponse.mutate()}
          >
            {requestResponse.isPending ? "Advancing…" : "Request the provider's response"}
          </Button>
          {(notes ?? []).length === 0 ? (
            <p className="mt-1 text-xs text-charcoal-ink/50">
              At least one investigation note is required before this can advance.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderResponseStage({
  complaintId,
  responseRequestedAt,
  providerResponse,
}: {
  complaintId: string;
  responseRequestedAt: string | null;
  providerResponse: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provider&apos;s response</CardTitle>
        <CardDescription>
          Requested {responseRequestedAt ? new Date(responseRequestedAt).toLocaleDateString() : "—"}.
          The provider submits this themselves from their own account — it can&apos;t be entered
          here on their behalf.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {providerResponse ? (
          <p className="text-sm text-charcoal-ink whitespace-pre-wrap">{providerResponse}</p>
        ) : (
          <p className="text-sm text-charcoal-ink/50">No response yet.</p>
        )}
        <ResolutionStage complaintId={complaintId} className="mt-4 border-t border-charcoal-ink/10 pt-4" />
      </CardContent>
    </Card>
  );
}

function ResolutionStage({
  complaintId,
  className,
}: {
  complaintId: string;
  className?: string;
}) {
  const resolve = useResolveProviderComplaint(complaintId);
  const [outcome, setOutcome] = useState("");
  const [summary, setSummary] = useState("");

  return (
    <div className={className}>
      <p className="mb-2 text-sm font-medium text-charcoal-ink">Resolve</p>
      <div className="space-y-2">
        <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Outcome…</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {o.replace("_", " ")}
            </option>
          ))}
        </Select>
        <Textarea
          placeholder="Resolution summary…"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
        />
        <Button
          type="button"
          size="sm"
          disabled={!outcome || !summary.trim() || resolve.isPending}
          onClick={() => resolve.mutate({ outcome, resolutionSummary: summary })}
        >
          {resolve.isPending ? "Saving…" : "Record resolution"}
        </Button>
      </div>
    </div>
  );
}

function GovernanceReviewStage({
  complaintId,
  category,
  callerClinicalStaffId,
  callerIsClinicalDirector,
}: {
  complaintId: string;
  category: string;
  callerClinicalStaffId: string | null;
  callerIsClinicalDirector: boolean;
}) {
  const review = useGovernanceReviewProviderComplaint(complaintId);
  const close = useCloseProviderComplaint(complaintId);
  const [notes, setNotes] = useState("");

  const requiresGovernance = category === "clinical";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Governance review</CardTitle>
        <CardDescription>
          {requiresGovernance
            ? "A clinical complaint may only close through a signed governance review — the database refuses any other path."
            : "Optional for a non-clinical complaint — you can close directly."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!callerIsClinicalDirector ? (
          <p className="text-sm text-amber-700">
            Only an active Clinical Director can sign this review — the database will reject the
            write otherwise.
          </p>
        ) : null}
        <Textarea
          placeholder="Governance notes…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={!notes.trim() || !callerClinicalStaffId || !callerIsClinicalDirector || review.isPending}
            onClick={() =>
              callerClinicalStaffId &&
              review.mutate({ clinicalStaffId: callerClinicalStaffId, notes })
            }
          >
            {review.isPending ? "Signing…" : "Sign governance review"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={close.isPending}
            onClick={() => close.mutate()}
          >
            {close.isPending ? "Closing…" : "Close"}
          </Button>
        </div>
        {(review.isError || close.isError) ? (
          <p className="text-xs text-red-600">
            {((review.error ?? close.error) as Error)?.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function WithdrawAction({ complaintId }: { complaintId: string }) {
  const withdraw = useWithdrawProviderComplaint(complaintId);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-charcoal-ink/40 underline"
      >
        Withdraw this complaint
      </button>
    );
  }

  return (
    <Card variant="soft">
      <CardContent className="space-y-2 py-4">
        <p className="text-sm text-charcoal-ink/70">Withdraw this complaint. This is terminal.</p>
        <Textarea
          placeholder="Reason for withdrawal…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!reason.trim() || withdraw.isPending}
            onClick={() => withdraw.mutate(reason)}
          >
            {withdraw.isPending ? "Withdrawing…" : "Confirm withdrawal"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
