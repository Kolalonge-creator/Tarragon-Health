"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TablesUpdate } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Not exported: a plain string exported from a "use client" module gets
// wrapped as a client reference when imported into a Server Component,
// which broke supabase-js's own internal `.split()` on it. page.tsx keeps
// its own identical copy for its server-side fetch instead.
const INCIDENT_REPORT_SELECT =
  "*, patient:profiles!clinical_incident_reports_patient_id_fkey(full_name), reporter:profiles!clinical_incident_reports_reported_by_fkey(full_name), reviewer:clinical_staff!clinical_incident_reports_reviewed_by_staff_fkey(full_name), closer:clinical_staff!clinical_incident_reports_closed_by_staff_fkey(full_name)";

export type IncidentCategory =
  | "medication_error"
  | "misdiagnosis_risk"
  | "escalation_delay"
  | "communication_breakdown"
  | "ai_recommendation_error"
  | "protocol_deviation"
  | "documentation_error"
  | "other";

export type IncidentSeverity = "near_miss" | "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "under_review" | "action_planned" | "closed";

export interface IncidentReportPatient {
  id: string;
  fullName: string | null;
  patientNumber: string | null;
  phone: string | null;
}

export type IncidentReportRow = {
  id: string;
  organisation_id: string;
  patient_id: string | null;
  reported_by: string | null;
  reported_at: string;
  occurred_at: string | null;
  category: string;
  severity: string;
  description: string;
  immediate_action_taken: string | null;
  contributing_factors: string | null;
  status: string;
  reviewed_by_staff: string | null;
  reviewed_by_tier: string | null;
  reviewed_at: string | null;
  review_outcome: string | null;
  corrective_action: string | null;
  closed_by_staff: string | null;
  closed_at: string | null;
  patient: { full_name: string | null } | null;
  reporter: { full_name: string | null } | null;
  reviewer: { full_name: string | null } | null;
  closer: { full_name: string | null } | null;
};

const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  medication_error: "Medication error",
  misdiagnosis_risk: "Misdiagnosis risk",
  escalation_delay: "Escalation delay",
  communication_breakdown: "Communication breakdown",
  ai_recommendation_error: "AI recommendation error",
  protocol_deviation: "Protocol deviation",
  documentation_error: "Documentation error",
  other: "Other",
};

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  near_miss: "Near miss (no harm reached the patient)",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const SEVERITY_VARIANT: Record<IncidentSeverity, "green" | "amber" | "red" | "grey"> = {
  near_miss: "grey",
  low: "grey",
  medium: "amber",
  high: "red",
  critical: "red",
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Open — needs review",
  under_review: "Under review",
  action_planned: "Action planned",
  closed: "Closed",
};

function PatientPicker({
  patients,
  patientId,
  onChange,
}: {
  patients: IncidentReportPatient[];
  patientId: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = patients.find((p) => p.id === patientId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients.slice(0, 10);
    return patients
      .filter(
        (p) =>
          (p.fullName ?? "").toLowerCase().includes(q) ||
          (p.patientNumber ?? "").toLowerCase().includes(q) ||
          (p.phone ?? "").includes(q),
      )
      .slice(0, 10);
  }, [patients, query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-charcoal-ink/10 px-3 py-2">
        <span className="truncate text-sm text-charcoal-ink">
          {selected.fullName ?? "Unnamed patient"}
          {selected.patientNumber ? ` · ${selected.patientNumber}` : ""}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="shrink-0 text-xs font-medium text-charcoal-ink/50 hover:text-charcoal-ink"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input
        placeholder="Search by name, patient number, or phone"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {query.trim() && (
        <ul className="max-h-40 divide-y divide-charcoal-ink/10 overflow-y-auto rounded-md border border-charcoal-ink/10">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-charcoal-ink/50">No matching patients.</li>
          ) : (
            filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setQuery("");
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-green/5"
                >
                  {p.fullName ?? "Unnamed patient"}
                  {p.patientNumber ? ` · ${p.patientNumber}` : ""}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function NewIncidentForm({
  organisationId,
  patients,
  onCreated,
}: {
  organisationId: string;
  patients: IncidentReportPatient[];
  onCreated: (row: IncidentReportRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<IncidentCategory>("other");
  const [severity, setSeverity] = useState<IncidentSeverity>("near_miss");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState("");
  const [description, setDescription] = useState("");
  const [immediateAction, setImmediateAction] = useState("");
  const [contributingFactors, setContributingFactors] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCategory("other");
    setSeverity("near_miss");
    setPatientId(null);
    setOccurredAt("");
    setDescription("");
    setImmediateAction("");
    setContributingFactors("");
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline">
        Report a near-miss or incident
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>File an incident or near-miss report</CardTitle>
        <CardDescription>
          File it now, even if the details aren&apos;t fully worked out yet — a near-miss (no harm
          reached the patient) is exactly the kind of signal this log exists to catch before it
          becomes a real incident.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="incident-category">Category</Label>
          <Select
            id="incident-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as IncidentCategory)}
          >
            {(Object.keys(CATEGORY_LABEL) as IncidentCategory[]).map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABEL[key]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-severity">Severity</Label>
          <Select
            id="incident-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
          >
            {(Object.keys(SEVERITY_LABEL) as IncidentSeverity[]).map((key) => (
              <option key={key} value={key}>
                {SEVERITY_LABEL[key]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Patient (optional — leave blank for a process/protocol near-miss)</Label>
          <PatientPicker patients={patients} patientId={patientId} onChange={setPatientId} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="incident-occurred">When it happened (optional)</Label>
          <Input
            id="incident-occurred"
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="incident-description">What happened</Label>
          <Textarea
            id="incident-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="incident-immediate-action">Immediate action taken (optional)</Label>
          <Textarea
            id="incident-immediate-action"
            rows={2}
            value={immediateAction}
            onChange={(e) => setImmediateAction(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="incident-contributing-factors">Contributing factors (optional)</Label>
          <Textarea
            id="incident-contributing-factors"
            rows={2}
            value={contributingFactors}
            onChange={(e) => setContributingFactors(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button
            disabled={pending || !description.trim()}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const supabase = createClient();
                const { data, error: insertError } = await supabase
                  .from("clinical_incident_reports")
                  .insert({
                    organisation_id: organisationId,
                    category,
                    severity,
                    patient_id: patientId,
                    occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
                    description: description.trim(),
                    immediate_action_taken: immediateAction.trim() || null,
                    contributing_factors: contributingFactors.trim() || null,
                  })
                  .select(INCIDENT_REPORT_SELECT)
                  .single();
                if (insertError || !data) {
                  setError(insertError?.message ?? "Could not file this report");
                  return;
                }
                onCreated(data as unknown as IncidentReportRow);
                reset();
                setOpen(false);
              });
            }}
          >
            {pending ? "Filing…" : "File report"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IncidentRow({
  incident,
  canReview,
  onUpdate,
}: {
  incident: IncidentReportRow;
  canReview: boolean;
  onUpdate: (row: IncidentReportRow) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState(incident.review_outcome ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(incident.corrective_action ?? "");
  const [error, setError] = useState<string | null>(null);

  const severity = incident.severity as IncidentSeverity;
  const status = incident.status as IncidentStatus;

  function patch(fields: TablesUpdate<"clinical_incident_reports">) {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: updateError } = await supabase
        .from("clinical_incident_reports")
        .update(fields)
        .eq("id", incident.id)
        .select(INCIDENT_REPORT_SELECT)
        .single();
      if (updateError || !data) {
        setError(updateError?.message ?? "Could not save");
        return;
      }
      onUpdate(data as unknown as IncidentReportRow);
    });
  }

  return (
    <div className="rounded-md border border-charcoal-ink/10 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={SEVERITY_VARIANT[severity]}>{SEVERITY_LABEL[severity]}</Badge>
          <Badge variant="grey">{CATEGORY_LABEL[incident.category as IncidentCategory] ?? incident.category}</Badge>
          <Badge variant={status === "closed" ? "grey" : "amber"}>{STATUS_LABEL[status]}</Badge>
        </div>
        <span className="text-xs text-charcoal-ink/50">
          Reported {new Date(incident.reported_at).toLocaleString()}
          {incident.reporter?.full_name ? ` by ${incident.reporter.full_name}` : ""}
        </span>
      </div>

      {incident.patient?.full_name && (
        <p className="text-xs text-charcoal-ink/50">Patient: {incident.patient.full_name}</p>
      )}
      <p className="text-sm text-charcoal-ink/70">{incident.description}</p>
      {incident.immediate_action_taken && (
        <p className="text-xs text-charcoal-ink/60">
          Immediate action: {incident.immediate_action_taken}
        </p>
      )}
      {incident.contributing_factors && (
        <p className="text-xs text-charcoal-ink/60">
          Contributing factors: {incident.contributing_factors}
        </p>
      )}

      {status !== "open" && (
        <p className="text-xs text-charcoal-ink/50">
          Reviewed by {incident.reviewer?.full_name ?? "—"}
          {incident.reviewed_at ? ` on ${new Date(incident.reviewed_at).toLocaleString()}` : ""}
        </p>
      )}
      {status === "closed" && (
        <div className="rounded-md bg-soft-sage/40 p-3 text-xs text-charcoal-ink/70 space-y-1">
          <p>
            <span className="font-medium">Outcome:</span> {incident.review_outcome}
          </p>
          <p>
            <span className="font-medium">Corrective action:</span> {incident.corrective_action}
          </p>
          <p className="text-charcoal-ink/50">
            Closed by {incident.closer?.full_name ?? "—"}
            {incident.closed_at ? ` on ${new Date(incident.closed_at).toLocaleString()}` : ""}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {status !== "closed" && (
        <div className="border-t border-charcoal-ink/10 pt-3">
          {!canReview ? (
            <p className="text-xs text-charcoal-ink/50">
              Only a clinical-tier member of the care team can review or close this report. A Care
              Coordinator can file one and add detail, but cannot review or close it.
            </p>
          ) : status === "open" ? (
            <Button size="sm" disabled={pending} onClick={() => patch({ status: "under_review" })}>
              Start review
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor={`outcome-${incident.id}`} className="text-xs">
                  Review outcome
                </Label>
                <Textarea
                  id={`outcome-${incident.id}`}
                  rows={2}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`corrective-${incident.id}`} className="text-xs">
                  Corrective action (or state explicitly that none is needed)
                </Label>
                <Textarea
                  id={`corrective-${incident.id}`}
                  rows={2}
                  value={correctiveAction}
                  onChange={(e) => setCorrectiveAction(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                {status === "under_review" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      patch({
                        status: "action_planned",
                        review_outcome: outcome.trim() || null,
                        corrective_action: correctiveAction.trim() || null,
                      })
                    }
                  >
                    Save as action planned
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={pending || !outcome.trim() || !correctiveAction.trim()}
                  onClick={() =>
                    patch({
                      status: "closed",
                      review_outcome: outcome.trim(),
                      corrective_action: correctiveAction.trim(),
                    })
                  }
                >
                  Close report
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function IncidentReportsManager({
  organisationId,
  initialReports,
  canReview,
  patients,
}: {
  organisationId: string;
  initialReports: IncidentReportRow[];
  canReview: boolean;
  patients: IncidentReportPatient[];
}) {
  const [reports, setReports] = useState(initialReports);

  return (
    <div className="space-y-6">
      <NewIncidentForm
        organisationId={organisationId}
        patients={patients}
        onCreated={(row) => setReports((prev) => [row, ...prev])}
      />
      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
          <CardDescription>
            {reports.filter((r) => r.status !== "closed").length} open or in progress.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {reports.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No incidents or near-misses logged.</p>
          ) : (
            reports.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                canReview={canReview}
                onUpdate={(row) =>
                  setReports((prev) => prev.map((r) => (r.id === row.id ? row : r)))
                }
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
