"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useAddIncidentDetail,
  useClinicalIncidents,
  useFileIncidentReport,
  useReviewIncidentReport,
  type ClinicalIncidentReport,
} from "@/lib/queries/clinical-incidents";
import {
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_CATEGORY_ORDER,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_SEVERITY_ORDER,
  INCIDENT_SEVERITY_SHORT,
  INCIDENT_SEVERITY_VARIANT,
  INCIDENT_STATUS_LABEL,
  INCIDENT_STATUS_VARIANT,
  isUnresolved,
  nextStatusesFor,
  sortIncidents,
  validateIncidentClosure,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/clinical/incident-governance";

/** Fixed locale + timezone: a bare toLocaleString() mismatches on hydration. */
function formatMoment(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ReportForm({ onDone }: { onDone: () => void }) {
  const file = useFileIncidentReport();
  const [category, setCategory] = useState<IncidentCategory>("escalation_delay");
  const [severity, setSeverity] = useState<IncidentSeverity>("near_miss");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [immediateAction, setImmediateAction] = useState("");
  const [contributingFactors, setContributingFactors] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report an incident or near miss</CardTitle>
        <CardDescription>
          Report it even if nothing reached the patient — a near miss is the most useful thing this
          log collects, and reporting one is never held against the person who reports it. Anyone on
          the team can file a report; a doctor reviews and closes it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="incident-category">What kind of problem was it?</Label>
          <Select
            id="incident-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as IncidentCategory)}
          >
            {INCIDENT_CATEGORY_ORDER.map((value) => (
              <option key={value} value={value}>
                {INCIDENT_CATEGORY_LABEL[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-severity">How far did it get?</Label>
          <Select
            id="incident-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
          >
            {INCIDENT_SEVERITY_ORDER.map((value) => (
              <option key={value} value={value}>
                {INCIDENT_SEVERITY_LABEL[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="incident-description">What happened?</Label>
          <Textarea
            id="incident-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened, in enough detail that a reviewer who was not there can follow it."
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-occurred">When did it happen? (optional)</Label>
          <Input
            id="incident-occurred"
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-immediate">What was done straight away? (optional)</Label>
          <Input
            id="incident-immediate"
            value={immediateAction}
            onChange={(e) => setImmediateAction(e.target.value)}
            placeholder="Patient called back, dose withheld…"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="incident-factors">
            What do you think contributed to it? (optional)
          </Label>
          <Textarea
            id="incident-factors"
            rows={2}
            value={contributingFactors}
            onChange={(e) => setContributingFactors(e.target.value)}
            placeholder="Handover gap, look-alike drug name, alert arrived out of hours…"
          />
        </div>
        {file.error && (
          <p className="text-sm text-red-700 sm:col-span-2" role="alert">
            {file.error.message}
          </p>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button
            disabled={file.isPending}
            onClick={() =>
              file.mutate(
                {
                  category,
                  severity,
                  description,
                  occurred_at: occurredAt ? new Date(occurredAt).toISOString() : undefined,
                  immediate_action_taken: immediateAction || undefined,
                  contributing_factors: contributingFactors || undefined,
                },
                { onSuccess: onDone },
              )
            }
          >
            {file.isPending ? "Filing…" : "File report"}
          </Button>
          <Button variant="outline" onClick={onDone} disabled={file.isPending}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The review controls. Rendered only for a clinical-tier viewer: a Care
 * Coordinator sees the report and can add detail to it, but the trigger would
 * refuse any status change they attempted, so offering the control would be
 * offering a button that always errors.
 */
function ReviewControls({ incident }: { incident: ClinicalIncidentReport }) {
  const review = useReviewIncidentReport();
  const options = nextStatusesFor(incident.status);
  const [status, setStatus] = useState<IncidentStatus | "">("");
  const [outcome, setOutcome] = useState(incident.review_outcome ?? "");
  const [action, setAction] = useState(incident.corrective_action ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  if (options.length === 0) return null;

  const closing = status === "closed";

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-warm-ivory/40 p-3">
      <div className="space-y-1">
        <Label htmlFor={`status_${incident.id}`} className="text-xs">
          Move this report on
        </Label>
        <Select
          id={`status_${incident.id}`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as IncidentStatus | "");
            setLocalError(null);
          }}
        >
          <option value="">Choose…</option>
          {options.map((value) => (
            <option key={value} value={value}>
              {INCIDENT_STATUS_LABEL[value]}
            </option>
          ))}
        </Select>
      </div>

      {closing && (
        <>
          <div className="space-y-1">
            <Label htmlFor={`outcome_${incident.id}`} className="text-xs">
              What did the review find?
            </Label>
            <Textarea
              id={`outcome_${incident.id}`}
              rows={2}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`action_${incident.id}`} className="text-xs">
              Corrective action — or say explicitly that none was needed
            </Label>
            <Textarea
              id={`action_${incident.id}`}
              rows={2}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>
          <p className="text-xs text-charcoal-ink/60">
            Closing is final — a closed report cannot be reopened or edited. If something new comes
            to light later, file a new report.
          </p>
        </>
      )}

      {(localError || review.error) && (
        <p className="text-sm text-red-700" role="alert">
          {localError ?? review.error?.message}
        </p>
      )}

      <Button
        size="sm"
        disabled={!status || review.isPending}
        onClick={() => {
          // nextStatusesFor never actually returns "open" (see
          // incident-governance.test.ts), but its declared return type is
          // the full IncidentStatus union — this guard narrows `status` to
          // what reviewIncidentReportSchema accepts.
          if (!status || status === "open") return;
          if (status === "closed") {
            const problem = validateIncidentClosure({
              reviewOutcome: outcome,
              correctiveAction: action,
            });
            if (problem) {
              setLocalError(problem);
              return;
            }
          }
          setLocalError(null);
          review.mutate({
            incident_id: incident.id,
            status,
            review_outcome: outcome.trim() || undefined,
            corrective_action: action.trim() || undefined,
          });
        }}
      >
        {review.isPending ? "Saving…" : closing ? "Close report" : "Update"}
      </Button>
    </div>
  );
}

/** Add-detail control, open to every org staff member while a report is not closed. */
function AddDetail({ incident }: { incident: ClinicalIncidentReport }) {
  const addDetail = useAddIncidentDetail();
  const [open, setOpen] = useState(false);
  const [factors, setFactors] = useState(incident.contributing_factors ?? "");

  if (incident.status === "closed") return null;
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add detail
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={`factors_${incident.id}`} className="text-xs">
        Contributing factors
      </Label>
      <Textarea
        id={`factors_${incident.id}`}
        rows={2}
        value={factors}
        onChange={(e) => setFactors(e.target.value)}
      />
      {addDetail.error && (
        <p className="text-sm text-red-700" role="alert">
          {addDetail.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={addDetail.isPending}
          onClick={() =>
            addDetail.mutate(
              { incident_id: incident.id, contributing_factors: factors },
              { onSuccess: () => setOpen(false) },
            )
          }
        >
          {addDetail.isPending ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function IncidentCard({
  incident,
  canReview,
}: {
  incident: ClinicalIncidentReport;
  canReview: boolean;
}) {
  return (
    <li className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={INCIDENT_SEVERITY_VARIANT[incident.severity]}>
          {INCIDENT_SEVERITY_SHORT[incident.severity]}
        </Badge>
        <Badge variant={INCIDENT_STATUS_VARIANT[incident.status]}>
          {INCIDENT_STATUS_LABEL[incident.status]}
        </Badge>
        <span className="text-sm font-medium text-charcoal-ink">
          {INCIDENT_CATEGORY_LABEL[incident.category]}
        </span>
      </div>

      <p className="text-sm whitespace-pre-wrap text-charcoal-ink/80">{incident.description}</p>

      <dl className="grid gap-x-6 gap-y-1 text-xs text-charcoal-ink/60 sm:grid-cols-2">
        <div className="flex gap-1">
          <dt>Reported</dt>
          <dd>
            {formatMoment(incident.reported_at)}
            {/* Null-gated: no joined profile means no name, never a placeholder. */}
            {incident.reporter?.full_name ? ` by ${incident.reporter.full_name}` : ""}
          </dd>
        </div>
        {incident.occurred_at && (
          <div className="flex gap-1">
            <dt>Occurred</dt>
            <dd>{formatMoment(incident.occurred_at)}</dd>
          </div>
        )}
        {incident.patient && (
          <div className="flex gap-1">
            <dt>Patient</dt>
            <dd>
              {incident.patient.full_name}
              {incident.patient.patient_number ? ` · ${incident.patient.patient_number}` : ""}
            </dd>
          </div>
        )}
        {incident.immediate_action_taken && (
          <div className="flex gap-1 sm:col-span-2">
            <dt>Immediate action</dt>
            <dd>{incident.immediate_action_taken}</dd>
          </div>
        )}
        {incident.contributing_factors && (
          <div className="flex gap-1 sm:col-span-2">
            <dt>Contributing factors</dt>
            <dd>{incident.contributing_factors}</dd>
          </div>
        )}
      </dl>

      {/* Attribution is shown only when a real clinical_staff row came back
          with the report — the null-gated ReviewedByDoctor rule. */}
      {incident.reviewed_by_staff_record && incident.reviewed_at && (
        <p className="text-xs text-charcoal-ink/60">
          Reviewed by {incident.reviewed_by_staff_record.full_name}
          {incident.reviewed_by_staff_record.credential_type
            ? ` (${incident.reviewed_by_staff_record.credential_type}${
                incident.reviewed_by_staff_record.credential_number
                  ? ` ${incident.reviewed_by_staff_record.credential_number}`
                  : ""
              })`
            : ""}{" "}
          on {formatMoment(incident.reviewed_at)}
        </p>
      )}

      {incident.status === "closed" && (
        <div className="space-y-1 rounded-lg bg-soft-sage/40 p-3 text-xs text-charcoal-ink/80">
          {incident.review_outcome && (
            <p>
              <span className="font-medium">Finding:</span> {incident.review_outcome}
            </p>
          )}
          {incident.corrective_action && (
            <p>
              <span className="font-medium">Corrective action:</span> {incident.corrective_action}
            </p>
          )}
          {incident.closed_by_staff_record && incident.closed_at && (
            <p className="text-charcoal-ink/60">
              Closed by {incident.closed_by_staff_record.full_name} on{" "}
              {formatMoment(incident.closed_at)}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <AddDetail incident={incident} />
      </div>
      {canReview && <ReviewControls incident={incident} />}
    </li>
  );
}

export function IncidentLog({ canReview }: { canReview: boolean }) {
  const { data, isLoading, error } = useClinicalIncidents();
  const [reporting, setReporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"unresolved" | "all" | IncidentStatus>(
    "unresolved",
  );

  const incidents = useMemo(() => {
    const rows = data ?? [];
    const filtered =
      statusFilter === "all"
        ? rows
        : statusFilter === "unresolved"
          ? rows.filter((r) => isUnresolved(r.status))
          : rows.filter((r) => r.status === statusFilter);
    return sortIncidents(filtered);
  }, [data, statusFilter]);

  return (
    <div className="space-y-4">
      {reporting ? (
        <ReportForm onDone={() => setReporting(false)} />
      ) : (
        <Button onClick={() => setReporting(true)}>Report an incident or near miss</Button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="incident-filter" className="text-xs">
          Show
        </Label>
        <Select
          id="incident-filter"
          className="w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="unresolved">Still open</option>
          <option value="closed">Closed</option>
          <option value="all">Everything</option>
        </Select>
      </div>

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading the log…</p>}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          Could not load the incident log.
        </p>
      )}
      {!isLoading && !error && incidents.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">
          {statusFilter === "unresolved"
            ? "Nothing open. Reports you or a colleague file will appear here."
            : "No reports match that filter yet."}
        </p>
      )}

      <ul className="space-y-3">
        {incidents.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} canReview={canReview} />
        ))}
      </ul>
    </div>
  );
}
