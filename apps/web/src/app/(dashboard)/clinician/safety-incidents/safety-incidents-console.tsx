"use client";

import { useState } from "react";
import {
  usePatientSafetyIncidents,
  useFileSafetyIncident,
  useReviewSafetyIncident,
  type SafetyIncident,
} from "@/lib/queries/safety-incidents";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const CATEGORY_LABEL: Record<string, string> = {
  medication_error: "Medication error",
  misdiagnosis_risk: "Misdiagnosis risk",
  escalation_delay: "Escalation delay",
  communication_breakdown: "Communication breakdown",
  ai_recommendation_error: "AI recommendation error",
  protocol_deviation: "Protocol deviation",
  documentation_error: "Documentation error",
  wrong_patient: "Wrong patient",
  missed_referral: "Missed referral",
  device_malfunction: "Device malfunction",
  duplicate_prescription: "Duplicate prescription",
  other: "Other",
};

const SEVERITY_BADGE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  near_miss: "blue",
  low: "grey",
  medium: "amber",
  high: "red",
  critical: "red",
};

const STATUS_BADGE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  open: "amber",
  under_review: "blue",
  action_planned: "blue",
  closed: "green",
};

const ROOT_CAUSE_LABEL: Record<string, string> = {
  human_factors: "Human factors",
  system_design: "System design",
  training: "Training",
  communication: "Communication",
  technical_failure: "Technical failure",
  process_failure: "Process failure",
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EMPTY_FORM = {
  category: "other",
  severity: "low",
  description: "",
  immediateActionTaken: "",
  contributingFactors: "",
};

function FileIncidentForm({ organisationId }: { organisationId: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const file = useFileSafetyIncident();

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        File a safety incident or near-miss
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>File a safety incident or near-miss</CardTitle>
        <CardDescription>
          Anyone on the care team can file one. A near-miss you caught before it reached the
          patient is exactly what this log is for.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Category</Label>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="near_miss">Near miss (no harm reached the patient)</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </div>
        </div>
        <div>
          <Label>What happened</Label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe what happened, as plainly as you can"
          />
        </div>
        <div>
          <Label>Immediate action taken (optional)</Label>
          <Input
            value={form.immediateActionTaken}
            onChange={(e) => setForm({ ...form, immediateActionTaken: e.target.value })}
          />
        </div>
        <div>
          <Label>Contributing factors (optional)</Label>
          <Textarea
            value={form.contributingFactors}
            onChange={(e) => setForm({ ...form, contributingFactors: e.target.value })}
          />
        </div>
        {file.isError && <p className="text-sm text-red-600">{(file.error as Error).message}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={form.description.trim().length === 0 || file.isPending}
            onClick={() =>
              file.mutate(
                {
                  organisationId,
                  category: form.category,
                  severity: form.severity,
                  description: form.description.trim(),
                  immediateActionTaken: form.immediateActionTaken.trim(),
                  contributingFactors: form.contributingFactors.trim(),
                },
                {
                  onSuccess: () => {
                    setForm(EMPTY_FORM);
                    setOpen(false);
                  },
                }
              )
            }
          >
            {file.isPending ? "Filing…" : "File report"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewControls({ incident }: { incident: SafetyIncident }) {
  const [reviewOutcome, setReviewOutcome] = useState(incident.review_outcome ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(incident.corrective_action ?? "");
  const [rootCauseCategory, setRootCauseCategory] = useState(incident.root_cause_category ?? "");
  const review = useReviewSafetyIncident();

  return (
    <div className="mt-3 space-y-2 border-t border-charcoal-ink/10 pt-3">
      {incident.status === "open" && (
        <Button
          size="sm"
          variant="outline"
          disabled={review.isPending}
          onClick={() => review.mutate({ incidentId: incident.id, status: "under_review" })}
        >
          Start review
        </Button>
      )}
      {(incident.status === "under_review" || incident.status === "action_planned") && (
        <>
          <div>
            <Label>Review outcome</Label>
            <Textarea
              value={reviewOutcome}
              onChange={(e) => setReviewOutcome(e.target.value)}
              placeholder="What did the review find?"
            />
          </div>
          <div>
            <Label>Corrective action</Label>
            <Textarea
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              placeholder="What changed as a result (or an explicit 'no action needed')"
            />
          </div>
          <div>
            <Label>Root cause (optional)</Label>
            <Select
              value={rootCauseCategory}
              onChange={(e) => setRootCauseCategory(e.target.value)}
            >
              <option value="">Not categorised</option>
              {Object.entries(ROOT_CAUSE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {review.isError && <p className="text-sm text-red-600">{(review.error as Error).message}</p>}
          <Button
            size="sm"
            disabled={reviewOutcome.trim().length === 0 || review.isPending}
            title="Locks this report permanently, no further edits after closing"
            onClick={() =>
              review.mutate({
                incidentId: incident.id,
                status: "closed",
                reviewOutcome: reviewOutcome.trim(),
                correctiveAction: correctiveAction.trim(),
                rootCauseCategory: rootCauseCategory || undefined,
              })
            }
          >
            {review.isPending ? "Closing…" : "Close report"}
          </Button>
        </>
      )}
    </div>
  );
}

function IncidentCard({ incident, canReview }: { incident: SafetyIncident; canReview: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">{CATEGORY_LABEL[incident.category] ?? incident.category}</CardTitle>
            <p className="text-xs text-charcoal-ink/50">
              {incident.patient?.full_name ?? "No specific patient"} · Filed{" "}
              {formatDateTime(incident.reported_at)}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant={SEVERITY_BADGE[incident.severity] ?? "grey"}>
              {incident.severity.replace(/_/g, " ")}
            </Badge>
            <Badge variant={STATUS_BADGE[incident.status] ?? "grey"}>
              {incident.status.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-charcoal-ink">
        <p>{incident.description}</p>
        {incident.immediate_action_taken && (
          <p>
            <span className="font-medium">Immediate action: </span>
            {incident.immediate_action_taken}
          </p>
        )}
        {incident.contributing_factors && (
          <p>
            <span className="font-medium">Contributing factors: </span>
            {incident.contributing_factors}
          </p>
        )}
        {incident.status === "closed" ? (
          <>
            {incident.review_outcome && (
              <p>
                <span className="font-medium">Review outcome: </span>
                {incident.review_outcome}
              </p>
            )}
            {incident.corrective_action && (
              <p>
                <span className="font-medium">Corrective action: </span>
                {incident.corrective_action}
              </p>
            )}
            {incident.root_cause_category && (
              <p>
                <span className="font-medium">Root cause: </span>
                {ROOT_CAUSE_LABEL[incident.root_cause_category] ?? incident.root_cause_category}
              </p>
            )}
          </>
        ) : (
          canReview && <ReviewControls incident={incident} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Clinical incident / near-miss console (docs spec §89.16) — built 2026-08-26
 * (clinical_incident_reports, private.enforce_clinical_incident_report_attribution)
 * with no UI anywhere despite the migration's own comment promising one "in
 * the clinician console." Any org staff (Care Coordinator included) may
 * file; only an active clinical-tier member may start a review or close one
 * — enforced server-side, canReview here is UX-only.
 */
export function SafetyIncidentsConsole({
  organisationId,
  canReview,
}: {
  organisationId: string;
  canReview: boolean;
}) {
  const { data: incidents, isLoading } = usePatientSafetyIncidents();
  const open = (incidents ?? []).filter((i) => i.status !== "closed");
  const closed = (incidents ?? []).filter((i) => i.status === "closed");

  return (
    <div className="space-y-6">
      <FileIncidentForm organisationId={organisationId} />

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}

      {!isLoading && (
        <>
          <div>
            <h2 className="mb-3 font-heading text-lg font-semibold text-charcoal-ink">
              Open ({open.length})
            </h2>
            {open.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">No open incidents or near-misses.</p>
            ) : (
              <div className="space-y-3">
                {open.map((incident) => (
                  <IncidentCard key={incident.id} incident={incident} canReview={canReview} />
                ))}
              </div>
            )}
          </div>

          {closed.length > 0 && (
            <div>
              <h2 className="mb-3 font-heading text-lg font-semibold text-charcoal-ink">
                Closed ({closed.length})
              </h2>
              <div className="space-y-3">
                {closed.map((incident) => (
                  <IncidentCard key={incident.id} incident={incident} canReview={canReview} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
