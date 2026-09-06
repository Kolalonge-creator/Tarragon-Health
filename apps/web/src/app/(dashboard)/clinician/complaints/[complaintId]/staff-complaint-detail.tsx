"use client";

import { useState } from "react";
import { useComplaint, useAdvanceComplaintStatus, useEscalateComplaintToIncident } from "@/lib/queries/complaints";
import { COMPLAINT_CATEGORY_LABEL, incidentCategorySchema, incidentSeveritySchema, type ComplaintCategoryInput } from "@/lib/validation/complaints";
import { COMPLAINT_STATUS_BADGE } from "@/lib/worklist/ticket-badge";
import { StaffAttributionLine } from "@/components/staff-attribution-line";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const STAGE_NOTE_PROMPT: Record<string, string> = {
  investigating: "What did you find?",
  response_sent: "What did you tell the patient?",
  resolved: "How was this resolved?",
  governance_review: "Governance review summary",
};

export function StaffComplaintDetail({
  complaintId,
  canReviewGovernance,
  currentProfileId,
}: {
  complaintId: string;
  canReviewGovernance: boolean;
  currentProfileId: string | null;
}) {
  const { data: complaint, isLoading } = useComplaint(complaintId);
  const advance = useAdvanceComplaintStatus();
  const escalate = useEscalateComplaintToIncident();

  const [note, setNote] = useState("");
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incidentDescription, setIncidentDescription] = useState("");
  const [incidentCategory, setIncidentCategory] = useState(incidentCategorySchema.options[0]);
  const [incidentSeverity, setIncidentSeverity] = useState(incidentSeveritySchema.options[0]);

  if (isLoading || !complaint) {
    return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  }

  const statusBadge = COMPLAINT_STATUS_BADGE[complaint.status];

  function startStage(stage: string) {
    setPendingStage(stage);
    setNote("");
  }

  function submitStage(stage: "acknowledged" | "assigned" | "investigating" | "response_sent" | "resolved" | "governance_review") {
    advance.mutate(
      {
        complaintId,
        to: stage,
        note: note || undefined,
        assigneeId: stage === "assigned" ? (currentProfileId ?? undefined) : undefined,
      },
      { onSuccess: () => setPendingStage(null) }
    );
  }

  const nextStages: { stage: "acknowledged" | "assigned" | "investigating" | "response_sent" | "resolved" | "governance_review"; label: string }[] =
    [];
  if (complaint.status === "received") nextStages.push({ stage: "acknowledged", label: "Acknowledge" });
  if (complaint.status === "received" || complaint.status === "acknowledged")
    nextStages.push({ stage: "assigned", label: "Assign to me" });
  if (complaint.status === "acknowledged" || complaint.status === "assigned")
    nextStages.push({ stage: "investigating", label: "Log investigation" });
  if (complaint.status === "investigating") nextStages.push({ stage: "response_sent", label: "Log response sent" });
  if (complaint.status === "response_sent") nextStages.push({ stage: "resolved", label: "Mark resolved" });
  if (complaint.status === "resolved" && canReviewGovernance)
    nextStages.push({ stage: "governance_review", label: "Complete governance review" });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
              {COMPLAINT_CATEGORY_LABEL[complaint.category as ComplaintCategoryInput] ?? complaint.category}
            </h2>
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
          <p className="text-xs text-charcoal-ink/60">{complaint.patient?.full_name ?? "Patient"}</p>
          <p className="text-sm text-charcoal-ink">{complaint.description}</p>
          <StaffAttributionLine label="Acknowledged by" staffId={complaint.acknowledged_by} staffName={null} at={complaint.acknowledged_at} />
          <StaffAttributionLine label="Assigned to" staffId={complaint.assigned_to} staffName={null} at={complaint.assigned_at} />
          {complaint.investigation_note && (
            <p className="text-sm text-charcoal-ink/70"><span className="font-medium text-charcoal-ink">Investigation:</span> {complaint.investigation_note}</p>
          )}
          {complaint.response_note && (
            <p className="text-sm text-charcoal-ink/70"><span className="font-medium text-charcoal-ink">Response:</span> {complaint.response_note}</p>
          )}
          {complaint.resolution_note && (
            <p className="text-sm text-charcoal-ink/70"><span className="font-medium text-charcoal-ink">Resolution:</span> {complaint.resolution_note}</p>
          )}
          {complaint.governance_note && (
            <p className="rounded-lg bg-brand-green/5 p-3 text-sm text-charcoal-ink">
              <span className="font-medium">Governance review:</span> {complaint.governance_note}
            </p>
          )}
          {complaint.incident_report_id && (
            <p className="text-sm font-medium text-amber-700">Escalated into a formal clinical incident report.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {nextStages.map(({ stage, label }) => (
          <Button key={stage} size="sm" variant={stage === "assigned" ? "outline" : "default"} onClick={() => startStage(stage)}>
            {label}
          </Button>
        ))}
        {complaint.status !== "governance_review" && !complaint.incident_report_id && !showIncidentForm && (
          <Button size="sm" variant="outline" onClick={() => setShowIncidentForm(true)}>
            Escalate to clinical incident report
          </Button>
        )}
      </div>

      {(pendingStage === "investigating" || pendingStage === "response_sent" || pendingStage === "resolved" || pendingStage === "governance_review") && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-charcoal-ink">{STAGE_NOTE_PROMPT[pendingStage]}</p>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
            />
            <Button size="sm" disabled={!note.trim() || advance.isPending} onClick={() => submitStage(pendingStage)}>
              {advance.isPending ? "Saving…" : "Save"}
            </Button>
          </CardContent>
        </Card>
      )}
      {(pendingStage === "assigned" || pendingStage === "acknowledged") && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <Button
              size="sm"
              disabled={advance.isPending}
              onClick={() => submitStage(pendingStage)}
            >
              {advance.isPending ? "Saving…" : pendingStage === "assigned" ? "Confirm assignment to me" : "Confirm acknowledged"}
            </Button>
          </CardContent>
        </Card>
      )}

      {showIncidentForm && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-charcoal-ink">File a clinical incident report</p>
            <select
              value={incidentCategory}
              onChange={(event) => setIncidentCategory(event.target.value as typeof incidentCategory)}
              className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
            >
              {incidentCategorySchema.options.map((option) => (
                <option key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <select
              value={incidentSeverity}
              onChange={(event) => setIncidentSeverity(event.target.value as typeof incidentSeverity)}
              className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
            >
              {incidentSeveritySchema.options.map((option) => (
                <option key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <textarea
              value={incidentDescription}
              onChange={(event) => setIncidentDescription(event.target.value)}
              rows={3}
              placeholder="What indicated potential patient harm?"
              className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
            />
            <Button
              size="sm"
              disabled={!incidentDescription.trim() || escalate.isPending}
              onClick={() =>
                escalate.mutate(
                  { complaintId, category: incidentCategory, severity: incidentSeverity, description: incidentDescription },
                  { onSuccess: () => setShowIncidentForm(false) }
                )
              }
            >
              {escalate.isPending ? "Filing…" : "File incident report"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
